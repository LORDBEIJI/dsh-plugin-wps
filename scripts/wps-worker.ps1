<#
  dsh-wps COM worker.

  One process per call: Node writes a UTF-8 JSON request file, runs this
  script with -Request/-Response, and reads the UTF-8 JSON response file back.
  Nothing is piped, so no console-encoding negotiation is involved.

  IMPORTANT: this file is deliberately pure ASCII. Windows PowerShell 5.1
  decodes a BOM-less script as ANSI, so any non-ASCII literal here (a CJK font
  name, for instance) would arrive corrupted. Localized values the worker needs
  are passed in the request JSON instead, which is decoded as explicit UTF-8.

  Safety rules enforced here:
    * An already-running WPS instance is reused, never hidden and never quit.
    * Only an instance this process created may have Visible changed or be quit.
    * Only documents this call opened are closed; the user's own documents are
      left untouched.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RequestPath,
  [Parameter(Mandatory = $true)][string]$ResponsePath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Deliberately not named $Response: PowerShell variable names are
# case-insensitive, so a response object sharing the parameter's name would
# collide with it.
$script:ReplyPath = $ResponsePath
$script:Warnings = New-Object System.Collections.ArrayList

function Add-Warning([string]$message) {
  [void]$script:Warnings.Add($message)
}

function Write-JsonFile([string]$path, $value) {
  $json = $value | ConvertTo-Json -Depth 14 -Compress
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $json, $utf8)
}

function Write-Response($payload) {
  Write-JsonFile $script:ReplyPath $payload
}

function Release-Com($object) {
  if ($null -ne $object) {
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($object) } catch { }
  }
}

# Reuse the user's running WPS when it is reachable through the Running Object
# Table; otherwise start a fresh hidden instance. `created` records ownership so
# the caller never hides or quits an instance it does not own.
function Get-OfficeApp([string]$progId) {
  try {
    $existing = [System.Runtime.InteropServices.Marshal]::GetActiveObject($progId)
    return @{ app = $existing; created = $false }
  } catch {
    $fresh = New-Object -ComObject $progId
    return @{ app = $fresh; created = $true }
  }
}

function Get-ProgIdInfo([string]$progId) {
  $info = [ordered]@{
    progId     = $progId
    registered = $false
    serverPath = $null
  }
  $clsidKeys = @(
    "HKLM:\SOFTWARE\Classes\$progId\CLSID",
    "HKLM:\SOFTWARE\Classes\WOW6432Node\$progId\CLSID",
    "HKCU:\SOFTWARE\Classes\$progId\CLSID"
  )
  foreach ($key in $clsidKeys) {
    if (-not (Test-Path $key)) { continue }
    $clsid = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
    if (-not $clsid) { continue }
    # Index assignment, not dot assignment: Windows PowerShell 5.1 rejects
    # property syntax on an ordered dictionary.
    $info['registered'] = $true
    foreach ($root in @(
        "HKLM:\SOFTWARE\Classes\CLSID",
        "HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID",
        "HKCU:\SOFTWARE\Classes\CLSID"
      )) {
      $serverKey = Join-Path $root "$clsid\LocalServer32"
      if (Test-Path $serverKey) {
        $info['serverPath'] = (Get-ItemProperty -Path $serverKey -ErrorAction SilentlyContinue).'(default)'
        break
      }
    }
    break
  }
  return $info
}

function Get-String($value, [string]$fallback = '') {
  if ($null -eq $value) { return $fallback }
  return [string]$value
}

function Get-Bool($value, [bool]$fallback = $false) {
  if ($null -eq $value) { return $fallback }
  if ($value -is [bool]) { return $value }
  $text = ([string]$value).Trim().ToLowerInvariant()
  if ($text -eq 'true' -or $text -eq '1') { return $true }
  if ($text -eq 'false' -or $text -eq '0') { return $false }
  return $fallback
}

# Format constants (Office / WPS numeric enumerations, localized-name free).
$WD_FORMAT_DOCX = 12      # wdFormatXMLDocument
$WD_FORMAT_DOC = 0        # wdFormatDocument
$WD_FORMAT_RTF = 6        # wdFormatRTF
$WD_FORMAT_TXT = 2        # wdFormatText
$WD_FORMAT_PDF = 17       # wdFormatPDF
$WD_DO_NOT_SAVE = 0       # wdDoNotSaveChanges
$WD_STYLE_NORMAL = -1     # wdStyleNormal
$WD_STYLE_HEADING = @{ 1 = -2; 2 = -3; 3 = -4; 4 = -4 }   # wdStyleHeading1..3
$WD_PAGE_BREAK = 7        # wdPageBreak
$XL_FORMAT_XLSX = 51      # xlOpenXMLWorkbook
$XL_FORMAT_XLS = 56       # xlExcel8
$XL_TYPE_PDF = 0          # xlTypePDF
$PP_LAYOUT_TITLE = 1      # ppLayoutTitle
$PP_LAYOUT_TEXT = 2       # ppLayoutText
$PP_LAYOUT_BLANK = 12     # ppLayoutBlank
$PP_SAVE_AS_PPTX = 24     # ppSaveAsOpenXMLPresentation
$PP_SAVE_AS_PDF = 32      # ppSaveAsPDF
$MSO_TRUE = -1

function Get-WriterSaveFormat([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    '.doc' { return $WD_FORMAT_DOC }
    '.rtf' { return $WD_FORMAT_RTF }
    '.txt' { return $WD_FORMAT_TXT }
    default { return $WD_FORMAT_DOCX }
  }
}

function Get-SheetSaveFormat([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq '.xls') { return $XL_FORMAT_XLS }
  return $XL_FORMAT_XLSX
}

# --- Writer content construction -------------------------------------------

function Add-WriterBlock($doc, $block, [bool]$reuseFirstParagraph, [string]$fontName) {
  $type = (Get-String $block.type 'paragraph').ToLowerInvariant()

  # Every block except a table anchors on a paragraph.
  if ($type -eq 'table') {
    $rows = @($block.rows)
    if ($rows.Count -eq 0) { Add-Warning 'table block had no rows'; return $false }
    $columns = @($rows[0]).Count
    if ($columns -eq 0) { Add-Warning 'table block had no columns'; return $false }
    $anchor = $doc.Paragraphs.Last.Range
    $table = $doc.Tables.Add($anchor, $rows.Count, $columns)
    for ($r = 1; $r -le $rows.Count; $r++) {
      $row = @($rows[$r - 1])
      for ($c = 1; $c -le $columns; $c++) {
        $value = ''
        if ($c -le $row.Count) { $value = Get-String $row[$c - 1] '' }
        $table.Cell($r, $c).Range.Text = $value
      }
    }
    if ((Get-Bool $block.header $true) -and $rows.Count -ge 1) {
      try { $table.Rows.Item(1).Range.Bold = $true } catch { Add-Warning 'could not bold the header row' }
    }
    try { $table.Borders.Enable = $true } catch { }
    # Leave the cursor in a paragraph after the table so later blocks do not
    # land inside the last cell.
    [void]$doc.Paragraphs.Add()
    return $false
  }

  if ($reuseFirstParagraph) {
    $paragraph = $doc.Paragraphs.Item(1)
  } else {
    $paragraph = $doc.Paragraphs.Add()
  }

  switch ($type) {
    'heading' {
      $level = 1
      if ($null -ne $block.level) { $level = [int]$block.level }
      if ($level -lt 1) { $level = 1 }
      if ($level -gt 4) { $level = 4 }
      $paragraph.Range.Text = Get-String $block.text
      try { $paragraph.Style = $doc.Styles.Item($WD_STYLE_HEADING[$level]) }
      catch { try { $paragraph.Range.Font.Bold = $true } catch { } }
    }
    'bullet' {
      $paragraph.Range.Text = Get-String $block.text
      try { $paragraph.Range.ListFormat.ApplyBulletDefault() }
      catch { Add-Warning 'bullet list formatting unavailable' }
    }
    'numbered' {
      $paragraph.Range.Text = Get-String $block.text
      try { $paragraph.Range.ListFormat.ApplyNumberDefault() }
      catch { Add-Warning 'numbered list formatting unavailable' }
    }
    'pagebreak' {
      $paragraph.Range.InsertBreak($WD_PAGE_BREAK)
    }
    'quote' {
      $paragraph.Range.Text = Get-String $block.text
      try {
        $paragraph.Range.Font.Italic = $true
        $paragraph.LeftIndent = 24
      } catch { }
    }
    default {
      $paragraph.Range.Text = Get-String $block.text
      if (Get-Bool $block.bold $false) {
        try { $paragraph.Range.Font.Bold = $true } catch { }
      }
      if ($null -ne $block.align) {
        $align = (Get-String $block.align).ToLowerInvariant()
        $map = @{ left = 0; center = 1; right = 2; justify = 3 }
        if ($map.ContainsKey($align)) {
          try { $paragraph.Alignment = $map[$align] } catch { }
        }
      }
    }
  }
  return $true
}

function Invoke-WriterCreate($p) {
  $path = Get-String $p.path
  $mode = (Get-String $p.mode 'create').ToLowerInvariant()
  $blocks = @($p.blocks)
  $fontName = Get-String $p.fontName $null

  $handle = Get-OfficeApp 'KWPS.Application'
  $app = $handle.app
  $doc = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }

    $appending = ($mode -eq 'append' -and (Test-Path -LiteralPath $path))
    if ($appending) {
      $doc = $app.Documents.Open($path)
    } else {
      $doc = $app.Documents.Add()
      if ($fontName -ne '') {
        try {
          $normal = $doc.Styles.Item($WD_STYLE_NORMAL)
          $normal.Font.Name = $fontName
          $normal.Font.NameFarEast = $fontName
        } catch { Add-Warning 'could not apply the requested document font' }
      }
    }

    $applied = 0
    $reuseFirst = -not $appending
    foreach ($block in $blocks) {
      $used = Add-WriterBlock $doc $block $reuseFirst $fontName
      if ($used) { $reuseFirst = $false }
      $applied++
    }

    $doc.SaveAs2($path, (Get-WriterSaveFormat $path))

    $pdfPath = $null
    if (Get-Bool $p.exportPdf $false) {
      $pdfPath = [System.IO.Path]::ChangeExtension($path, '.pdf')
      $doc.ExportAsFixedFormat($pdfPath, $WD_FORMAT_PDF)
    }

    $data = [ordered]@{
      path           = $path
      mode           = $(if ($appending) { 'append' } else { 'create' })
      blocks         = $applied
      paragraphs     = $doc.Paragraphs.Count
      words          = $doc.Words.Count
      pdfPath        = $pdfPath
      appReused      = (-not $handle.created)
    }
    try { $doc.Close($WD_DO_NOT_SAVE) } catch { }
    $doc = $null
    return $data
  } finally {
    Release-Com $doc
    Release-Com $app
  }
}

function Invoke-WriterRead($p) {
  $path = Get-String $p.path
  $maxChars = 200000
  if ($null -ne $p.maxChars) { $maxChars = [int]$p.maxChars }

  $handle = Get-OfficeApp 'KWPS.Application'
  $app = $handle.app
  $doc = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }
    $doc = $app.Documents.Open($path, $false, $true)
    $text = Get-String $doc.Content.Text
    $truncated = $false
    if ($text.Length -gt $maxChars) {
      $text = $text.Substring(0, $maxChars)
      $truncated = $true
    }
    return [ordered]@{
      path      = $path
      text      = $text
      characters = $doc.Content.Text.Length
      paragraphs = $doc.Paragraphs.Count
      truncated = $truncated
    }
  } finally {
    if ($null -ne $doc) { try { $doc.Close($WD_DO_NOT_SAVE) } catch { } }
    Release-Com $doc
    Release-Com $app
  }
}

function Invoke-SheetCreate($p) {
  $path = Get-String $p.path
  $sheets = @($p.sheets)

  $handle = Get-OfficeApp 'KET.Application'
  $app = $handle.app
  $book = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }
    if (Get-Bool $p.append $false -and (Test-Path -LiteralPath $path)) {
      $book = $app.Workbooks.Open($path)
    } else {
      $book = $app.Workbooks.Add()
    }

    $written = New-Object System.Collections.ArrayList
    $first = $true
    foreach ($sheetSpec in $sheets) {
      if ($first) {
        $sheet = $book.Worksheets.Item(1)
        $first = $false
      } else {
        $sheet = $book.Worksheets.Add([System.Reflection.Missing]::Value, $book.Worksheets.Item($book.Worksheets.Count))
      }
      $name = Get-String $sheetSpec.name
      if ($name -ne '') {
        try { $sheet.Name = $name } catch { Add-Warning "sheet name '$name' was rejected; kept the default" }
      }

      $rows = @($sheetSpec.rows)
      if ($rows.Count -gt 0) {
        $columns = 0
        foreach ($row in $rows) {
          $count = @($row).Count
          if ($count -gt $columns) { $columns = $count }
        }
        if ($columns -gt 0) {
          # One bulk Value2 assignment instead of per-cell COM calls: this is
          # the difference between seconds and minutes on a large sheet.
          $block = New-Object 'object[,]' $rows.Count, $columns
          for ($r = 0; $r -lt $rows.Count; $r++) {
            $row = @($rows[$r])
            for ($c = 0; $c -lt $columns; $c++) {
              $value = $null
              if ($c -lt $row.Count) { $value = $row[$c] }
              $block[$r, $c] = $value
            }
          }
          $range = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item($rows.Count, $columns))
          $range.Value2 = $block
        }
        if ((Get-Bool $sheetSpec.header $true) -and $rows.Count -ge 1) {
          try {
            $headerRange = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item(1, $columns))
            $headerRange.Font.Bold = $true
          } catch { Add-Warning 'could not bold the header row' }
        }
      }

      if (Get-Bool ($sheetSpec.autoFit) $true) {
        try { $sheet.UsedRange.Columns.AutoFit() | Out-Null } catch { }
      }
      if (Get-Bool ($sheetSpec.freezeHeader) $false) {
        try { $sheet.Activate(); $app.ActiveWindow.FreezePanes = $false; $sheet.Range('A2').Select() | Out-Null; $app.ActiveWindow.FreezePanes = $true } catch { Add-Warning 'could not freeze the header row' }
      }

      [void]$written.Add([ordered]@{ name = Get-String $sheet.Name; rows = $rows.Count })
    }

    $book.SaveAs($path, (Get-SheetSaveFormat $path))
    $data = [ordered]@{
      path      = $path
      sheets    = @($written.ToArray())
      appReused = (-not $handle.created)
    }
    try { $book.Close($false) } catch { }
    $book = $null
    return $data
  } finally {
    Release-Com $book
    Release-Com $app
  }
}

function Invoke-SheetRead($p) {
  $path = Get-String $p.path
  $maxRows = 5000
  $maxColumns = 200
  if ($null -ne $p.maxRows) { $maxRows = [int]$p.maxRows }
  if ($null -ne $p.maxColumns) { $maxColumns = [int]$p.maxColumns }

  $handle = Get-OfficeApp 'KET.Application'
  $app = $handle.app
  $book = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }
    $book = $app.Workbooks.Open($path, 0, $true)
    $sheetName = Get-String $p.sheet
    if ($sheetName -ne '') {
      $sheet = $book.Worksheets.Item($sheetName)
    } else {
      $sheet = $book.Worksheets.Item(1)
    }

    $used = $sheet.UsedRange
    $rowCount = [int]$used.Rows.Count
    $columnCount = [int]$used.Columns.Count
    $truncated = $false
    if ($rowCount -gt $maxRows) { $rowCount = $maxRows; $truncated = $true }
    if ($columnCount -gt $maxColumns) { $columnCount = $maxColumns; $truncated = $true }

    $rows = New-Object System.Collections.ArrayList
    if ($rowCount -gt 0 -and $columnCount -gt 0) {
      $firstRow = [int]$used.Row
      $firstColumn = [int]$used.Column
      $range = $sheet.Range(
        $sheet.Cells.Item($firstRow, $firstColumn),
        $sheet.Cells.Item($firstRow + $rowCount - 1, $firstColumn + $columnCount - 1)
      )
      $values = $range.Value2
      for ($r = 1; $r -le $rowCount; $r++) {
        $row = New-Object System.Collections.ArrayList
        for ($c = 1; $c -le $columnCount; $c++) {
          $cell = $null
          if ($rowCount -eq 1 -and $columnCount -eq 1) {
            $cell = $values
          } else {
            $cell = $values[$r, $c]
          }
          [void]$row.Add($cell)
        }
        [void]$rows.Add(@($row.ToArray()))
      }
    }

    $names = New-Object System.Collections.ArrayList
    foreach ($ws in $book.Worksheets) { [void]$names.Add([string]$ws.Name) }

    return [ordered]@{
      path        = $path
      sheet       = [string]$sheet.Name
      sheetNames  = @($names.ToArray())
      rowCount    = $rowCount
      columnCount = $columnCount
      truncated   = $truncated
      rows        = @($rows.ToArray())
    }
  } finally {
    if ($null -ne $book) { try { $book.Close($false) } catch { } }
    Release-Com $book
    Release-Com $app
  }
}

function Invoke-SlidesCreate($p) {
  $path = Get-String $p.path
  $slides = @($p.slides)
  $fontName = Get-String $p.fontName ''

  $handle = Get-OfficeApp 'KWPP.Application'
  $app = $handle.app
  $presentation = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }
    $presentation = $app.Presentations.Add()

    $index = 1
    foreach ($spec in $slides) {
      $title = Get-String $spec.title
      $bullets = @($spec.bullets)
      $layout = $PP_LAYOUT_BLANK
      if ($title -ne '' -and $bullets.Count -gt 0) { $layout = $PP_LAYOUT_TEXT }
      elseif ($title -ne '') { $layout = $PP_LAYOUT_TITLE }

      $slide = $presentation.Slides.Add($index, $layout)
      if ($title -ne '') {
        try {
          $titleRange = $slide.Shapes.Title.TextFrame.TextRange
          $titleRange.Text = $title
          if ($fontName -ne '') {
            $titleRange.Font.Name = $fontName
            $titleRange.Font.NameFarEast = $fontName
          }
        } catch { Add-Warning "slide $index has no usable title placeholder" }
      }
      if ($bullets.Count -gt 0) {
        try {
          $bodyRange = $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange
          $bodyRange.Text = (@($bullets) -join "`r")
          if ($fontName -ne '') {
            $bodyRange.Font.Name = $fontName
            $bodyRange.Font.NameFarEast = $fontName
          }
        } catch { Add-Warning "slide $index has no usable body placeholder" }
      }
      $index++
    }

    $presentation.SaveAs($path, $PP_SAVE_AS_PPTX)
    $data = [ordered]@{
      path       = $path
      slides     = $presentation.Slides.Count
      appReused  = (-not $handle.created)
    }
    try { $presentation.Close() } catch { }
    $presentation = $null
    return $data
  } finally {
    Release-Com $presentation
    Release-Com $app
  }
}

function Invoke-SlidesRead($p) {
  $path = Get-String $p.path
  $handle = Get-OfficeApp 'KWPP.Application'
  $app = $handle.app
  $presentation = $null
  try {
    if ($handle.created) { try { $app.Visible = $false } catch { } }
    $presentation = $app.Presentations.Open($path, $MSO_TRUE, $false, $false)
    $slides = New-Object System.Collections.ArrayList
    for ($i = 1; $i -le $presentation.Slides.Count; $i++) {
      $slide = $presentation.Slides.Item($i)
      $texts = New-Object System.Collections.ArrayList
      foreach ($shape in $slide.Shapes) {
        try {
          if ($shape.HasTextFrame -eq $MSO_TRUE -and $shape.TextFrame.HasText -eq $MSO_TRUE) {
            $text = Get-String $shape.TextFrame.TextRange.Text
            if ($text.Trim() -ne '') { [void]$texts.Add($text) }
          }
        } catch { }
      }
      [void]$slides.Add([ordered]@{ index = $i; text = @($texts.ToArray()) })
    }
    return [ordered]@{
      path   = $path
      slides = @($slides.ToArray())
      count  = $presentation.Slides.Count
    }
  } finally {
    if ($null -ne $presentation) { try { $presentation.Close() } catch { } }
    Release-Com $presentation
    Release-Com $app
  }
}

function Invoke-ConvertPdf($p) {
  $source = Get-String $p.path
  $target = Get-String $p.outPath
  if ($target -eq '') { $target = [System.IO.Path]::ChangeExtension($source, '.pdf') }
  $ext = [System.IO.Path]::GetExtension($source).ToLowerInvariant()

  if ($ext -eq '.doc' -or $ext -eq '.docx' -or $ext -eq '.rtf' -or $ext -eq '.txt') {
    $handle = Get-OfficeApp 'KWPS.Application'
    $app = $handle.app
    $doc = $null
    try {
      if ($handle.created) { try { $app.Visible = $false } catch { } }
      $doc = $app.Documents.Open($source, $false, $true)
      $doc.ExportAsFixedFormat($target, $WD_FORMAT_PDF)
      return [ordered]@{ path = $source; pdfPath = $target; engine = 'wps-writer' }
    } finally {
      if ($null -ne $doc) { try { $doc.Close($WD_DO_NOT_SAVE) } catch { } }
      Release-Com $doc
      Release-Com $app
    }
  }

  if ($ext -eq '.xls' -or $ext -eq '.xlsx' -or $ext -eq '.csv') {
    $handle = Get-OfficeApp 'KET.Application'
    $app = $handle.app
    $book = $null
    try {
      if ($handle.created) { try { $app.Visible = $false } catch { } }
      $book = $app.Workbooks.Open($source, 0, $true)
      $book.ExportAsFixedFormat($XL_TYPE_PDF, $target)
      return [ordered]@{ path = $source; pdfPath = $target; engine = 'wps-spreadsheets' }
    } finally {
      if ($null -ne $book) { try { $book.Close($false) } catch { } }
      Release-Com $book
      Release-Com $app
    }
  }

  if ($ext -eq '.ppt' -or $ext -eq '.pptx') {
    $handle = Get-OfficeApp 'KWPP.Application'
    $app = $handle.app
    $presentation = $null
    try {
      if ($handle.created) { try { $app.Visible = $false } catch { } }
      $presentation = $app.Presentations.Open($source, $MSO_TRUE, $false, $false)
      $presentation.SaveAs($target, $PP_SAVE_AS_PDF)
      return [ordered]@{ path = $source; pdfPath = $target; engine = 'wps-presentation' }
    } finally {
      if ($null -ne $presentation) { try { $presentation.Close() } catch { } }
      Release-Com $presentation
      Release-Com $app
    }
  }

  throw "unsupported source extension for PDF conversion: $ext"
}

function Invoke-Open($p) {
  $path = Get-String $p.path
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  $handle = $null
  $app = $null
  try {
    if ($ext -eq '.xls' -or $ext -eq '.xlsx' -or $ext -eq '.csv') {
      $handle = Get-OfficeApp 'KET.Application'
      $app = $handle.app
      try { $app.Visible = $true } catch { }
      $item = $app.Workbooks.Open($path)
      return [ordered]@{ path = $path; app = 'wps-spreadsheets'; appReused = (-not $handle.created) }
    }
    if ($ext -eq '.ppt' -or $ext -eq '.pptx') {
      $handle = Get-OfficeApp 'KWPP.Application'
      $app = $handle.app
      try { $app.Visible = $true } catch { }
      $item = $app.Presentations.Open($path, $false, $false, $true)
      return [ordered]@{ path = $path; app = 'wps-presentation'; appReused = (-not $handle.created) }
    }
    $handle = Get-OfficeApp 'KWPS.Application'
    $app = $handle.app
    try { $app.Visible = $true } catch { }
    $item = $app.Documents.Open($path)
    return [ordered]@{ path = $path; app = 'wps-writer'; appReused = (-not $handle.created) }
  } finally {
    # Never quit here: an open document must survive this process exiting so the
    # user can look at it.
    Release-Com $app
  }
}

# Release automation instances. The guard is the safety property: by default an
# instance is quit only when it holds no open document, so an agent call can
# never close a user's own editing session. `force` is for instances the caller
# positively owns (it created them and knows nothing is open in them).
function Invoke-Quit($p) {
  $force = Get-Bool $p.force $false
  $results = New-Object System.Collections.ArrayList
  $apps = [ordered]@{
    writer       = 'KWPS.Application'
    spreadsheets = 'KET.Application'
    presentation = 'KWPP.Application'
  }
  foreach ($key in $apps.Keys) {
    $app = $null
    try {
      $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject($apps[$key])
    } catch {
      [void]$results.Add([ordered]@{ engine = $key; connected = $false; quit = $false; openDocuments = 0; skippedReason = 'not running under automation' })
      continue
    }
    $openCount = 0
    try {
      switch ($key) {
        'writer' { $openCount = [int]$app.Documents.Count }
        'spreadsheets' { $openCount = [int]$app.Workbooks.Count }
        'presentation' { $openCount = [int]$app.Presentations.Count }
      }
    } catch { }
    $quit = $false
    $reason = $null
    if ($openCount -eq 0) {
      try { $app.Quit(); $quit = $true } catch { $reason = 'quit failed' }
    } elseif ($force) {
      try { $app.Quit(); $quit = $true } catch { $reason = 'quit failed' }
    } else {
      $reason = 'instance holds open documents'
    }
    Release-Com $app
    [void]$results.Add([ordered]@{ engine = $key; connected = $true; quit = $quit; openDocuments = $openCount; skippedReason = $reason })
  }
  return [ordered]@{ results = @($results.ToArray()) }
}

function Invoke-Close($p) {
  $path = Get-String $p.path
  $full = [System.IO.Path]::GetFullPath($path)
  $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  $closed = New-Object System.Collections.ArrayList

  if ($ext -eq '.xls' -or $ext -eq '.xlsx' -or $ext -eq '.csv') {
    $handle = Get-OfficeApp 'KET.Application'
    $app = $handle.app
    try {
      $targets = @()
      foreach ($book in $app.Workbooks) {
        try { if ([System.IO.Path]::GetFullPath($book.FullName) -eq $full) { $targets += $book } } catch { }
      }
      foreach ($book in $targets) { $book.Close($false); [void]$closed.Add($book.Name) }
    } finally { Release-Com $app }
    return [ordered]@{ path = $path; closed = @($closed.ToArray()) }
  }

  if ($ext -eq '.ppt' -or $ext -eq '.pptx') {
    $handle = Get-OfficeApp 'KWPP.Application'
    $app = $handle.app
    try {
      $targets = @()
      foreach ($presentation in $app.Presentations) {
        try { if ([System.IO.Path]::GetFullPath($presentation.FullName) -eq $full) { $targets += $presentation } } catch { }
      }
      foreach ($presentation in $targets) { $presentation.Close(); [void]$closed.Add($presentation.Name) }
    } finally { Release-Com $app }
    return [ordered]@{ path = $path; closed = @($closed.ToArray()) }
  }

  $handle = Get-OfficeApp 'KWPS.Application'
  $app = $handle.app
  try {
    $targets = @()
    foreach ($doc in $app.Documents) {
      try { if ([System.IO.Path]::GetFullPath($doc.FullName) -eq $full) { $targets += $doc } } catch { }
    }
    foreach ($doc in $targets) { $doc.Close($WD_DO_NOT_SAVE); [void]$closed.Add($doc.Name) }
  } finally { Release-Com $app }
  return [ordered]@{ path = $path; closed = @($closed.ToArray()) }
}

function Invoke-Env($p) {
  $engines = New-Object System.Collections.ArrayList
  $map = [ordered]@{
    writer       = 'KWPS.Application'
    spreadsheets = 'KET.Application'
    presentation = 'KWPP.Application'
  }
  foreach ($key in $map.Keys) {
    $info = Get-ProgIdInfo $map[$key]
    [void]$engines.Add([ordered]@{
        engine     = $key
        progId     = $info.progId
        registered = $info.registered
        serverPath = $info.serverPath
      })
  }
  $running = @()
  try {
    $running = @(Get-Process -Name wps, et, wpp -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Name)
  } catch { }
  return [ordered]@{
    engines         = @($engines.ToArray())
    runningApps     = @($running)
    powershell      = $PSVersionTable.PSVersion.ToString()
    apartmentState  = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
  }
}

# --- dispatch ---------------------------------------------------------------

$reply = [ordered]@{
  ok       = $false
  op       = $null
  data     = $null
  warnings = @()
  error    = $null
}

try {
  $raw = [System.IO.File]::ReadAllText($RequestPath, [System.Text.Encoding]::UTF8)
  $request = $raw | ConvertFrom-Json
  $op = Get-String $request.op
  $reply['op'] = $op
  $params = $request.params
  if ($null -eq $params) { $params = (New-Object psobject) }

  $data = switch ($op) {
    'env' { Invoke-Env $params }
    'writer.create' { Invoke-WriterCreate $params }
    'writer.read' { Invoke-WriterRead $params }
    'sheet.create' { Invoke-SheetCreate $params }
    'sheet.read' { Invoke-SheetRead $params }
    'slides.create' { Invoke-SlidesCreate $params }
    'slides.read' { Invoke-SlidesRead $params }
    'convert.pdf' { Invoke-ConvertPdf $params }
    'open' { Invoke-Open $params }
    'close' { Invoke-Close $params }
    'quit' { Invoke-Quit $params }
    default { throw "unknown op: $op" }
  }

  $reply['ok'] = $true
  $reply['data'] = $data
} catch {
  $reply['ok'] = $false
  $reply['error'] = $_.Exception.Message
  $reply['data'] = $null
}

$reply['warnings'] = @($script:Warnings.ToArray())
Write-Response $reply
