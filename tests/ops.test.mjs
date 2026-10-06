// Pure domain logic: path resolution, write safety, and text rendering. No WPS
// process is involved, so these run in milliseconds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WpsUsageError,
  assertReadable,
  assertWritable,
  cleanSlideText,
  cleanWriterText,
  defaultPdfPath,
  renderEnv,
  renderGrid,
  renderSheetRead,
  renderWriterRead,
  resolvePath,
} from '../lib/ops.js'

test('resolvePath absolutizes a relative path and normalizes separators', () => {
  const resolved = resolvePath('reports/q3.docx')
  assert.ok(resolved.endsWith('reports\\q3.docx') || resolved.endsWith('reports/q3.docx'))
  assert.ok(resolved.length > 'reports/q3.docx'.length)
})

test('resolvePath leaves an absolute path alone', () => {
  assert.equal(resolvePath('E:\\dsh-plugin\\out.docx'), 'E:\\dsh-plugin\\out.docx')
})

test('resolvePath rejects an empty path', () => {
  assert.throws(() => resolvePath('   '), WpsUsageError)
})

test('a create write refuses to clobber an existing file without overwrite', () => {
  assert.throws(
    () => assertWritable({ path: 'E:\\a.docx', mode: 'create', overwrite: false, exists: true }),
    /already exists/,
  )
})

test('a create write proceeds when overwrite is explicit', () => {
  assert.doesNotThrow(() => assertWritable({ path: 'E:\\a.docx', mode: 'create', overwrite: true, exists: true }))
})

test('a create write proceeds when the target is new', () => {
  assert.doesNotThrow(() => assertWritable({ path: 'E:\\a.docx', mode: 'create', overwrite: false, exists: false }))
})

test('append requires an existing file', () => {
  assert.throws(
    () => assertWritable({ path: 'E:\\a.docx', mode: 'append', overwrite: false, exists: false }),
    /does not exist/,
  )
  assert.doesNotThrow(() => assertWritable({ path: 'E:\\a.docx', mode: 'append', overwrite: false, exists: true }))
})

test('append never demands overwrite consent', () => {
  assert.doesNotThrow(() => assertWritable({ path: 'E:\\a.docx', mode: 'append', overwrite: false, exists: true }))
})

test('assertReadable rejects a missing source', () => {
  assert.throws(() => assertReadable('E:\\missing.docx', false), WpsUsageError)
  assert.doesNotThrow(() => assertReadable('E:\\present.docx', true))
})

test('defaultPdfPath swaps the extension beside the source', () => {
  assert.equal(defaultPdfPath('E:\\reports\\q3.docx'), 'E:\\reports\\q3.pdf')
  assert.equal(defaultPdfPath('E:\\reports\\q3'), 'E:\\reports\\q3.pdf')
  assert.equal(defaultPdfPath('E:\\a.b\\c.xlsx'), 'E:\\a.b\\c.pdf')
})

test('cleanSlideText normalizes CR and trims', () => {
  assert.equal(cleanSlideText('业务亮点\r营收\r新增客户'), '业务亮点\n营收\n新增客户')
})

test('cleanWriterText turns Word cell markers into readable rows', () => {
  // Real WPS output for a 2x2 table: cell, CR+BEL, cell, CR+BEL, CR+BEL.
  const raw = '区域\r\u0007营收\r\u0007\r\u0007华东\r\u00071,240\r\u0007\r\u0007'
  const cleaned = cleanWriterText(raw)
  assert.ok(!cleaned.includes('\u0007'), 'cell markers must not survive')
  assert.equal(cleaned, '区域 | 营收\n华东 | 1,240')
})

test('cleanWriterText keeps a single-column table row on its own line', () => {
  assert.equal(cleanWriterText('只有一个\r\u0007\r\u0007'), '只有一个')
})

test('cleanWriterText normalizes CR and CRLF to LF', () => {
  assert.equal(cleanWriterText('a\r\nb\rc'), 'a\nb\nc')
})

test('cleanWriterText preserves CJK and punctuation', () => {
  const text = '季度报告：营收「增长」18.4%，含 emoji ✅'
  assert.equal(cleanWriterText(text), text)
})

test('renderGrid emits tab-separated rows and blanks nulls', () => {
  assert.equal(renderGrid([['a', 1], [null, true]]), 'a\t1\n\ttrue')
})

test('renderGrid flattens embedded newlines so a row stays on one line', () => {
  assert.equal(renderGrid([['line1\nline2']]), 'line1 line2')
})

test('renderEnv reports availability and running processes', () => {
  const rendered = renderEnv({
    engines: [{ engine: 'writer', progId: 'KWPS.Application', registered: true, serverPath: 'D:\\wps\\wps.exe' }],
    runningApps: ['wps', 'wps'],
    powershell: '5.1.26100.9444',
    apartmentState: 'STA',
  })
  assert.ok(rendered.includes('writer'))
  assert.ok(rendered.includes('available'))
  assert.ok(rendered.includes('PowerShell: 5.1'))
  assert.ok(!rendered.includes('NOT REGISTERED'))
})

test('renderEnv flags an unregistered engine', () => {
  const rendered = renderEnv({
    engines: [{ engine: 'presentation', progId: 'KWPP.Application', registered: false, serverPath: null }],
    runningApps: [],
    powershell: '5.1',
    apartmentState: 'STA',
  })
  assert.ok(rendered.includes('NOT REGISTERED'))
  assert.ok(rendered.includes('none'))
})

test('renderWriterRead marks truncation', () => {
  const rendered = renderWriterRead({
    path: 'E:\\a.docx', text: 'abc', characters: 999, paragraphs: 3, truncated: true,
  })
  assert.ok(rendered.includes('999 characters'))
  assert.ok(rendered.includes('truncated'))
})

test('renderSheetRead lists available sheets and marks the active one', () => {
  const rendered = renderSheetRead({
    path: 'E:\\a.xlsx', sheet: '汇总', sheetNames: ['明细', '汇总'],
    rowCount: 1, columnCount: 2, truncated: false, rows: [['a', 'b']],
  })
  assert.ok(rendered.includes('sheet "汇总"'))
  assert.ok(rendered.includes('available sheets: 明细, 汇总'))
  assert.ok(rendered.includes('a\tb'))
})
