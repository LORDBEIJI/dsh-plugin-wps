// End-to-end: these drive the real WPS installation through COM, so they are
// slow (seconds per call) and they are the only tests that prove the plugin
// actually produces Office files this machine can open.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  wpsConvertPdfTool,
  wpsEnvTool,
  wpsQuitTool,
  wpsSheetCreateTool,
  wpsSheetReadTool,
  wpsSlidesCreateTool,
  wpsSlidesReadTool,
  wpsWriterCreateTool,
  wpsWriterReadTool,
} from '../lib/tools.js'

const exec = { signal: new AbortController().signal }
const TIMEOUT = { timeout: 300_000 }

let directory
let wpsAvailable = false

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dsh-wps-e2e-'))
  const env = await wpsEnvTool().execute({}, exec)
  wpsAvailable = env.engines.every(engine => engine.registered)
})

after(async () => {
  // Release automation instances so the suite does not leave WPS resident.
  try { await wpsQuitTool().execute({}, exec) } catch { /* cleanup is best effort */ }
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
})

test('wps_env reports the installed engines without launching WPS', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const env = await wpsEnvTool().execute({}, exec)
  assert.equal(env.engines.length, 3)
  for (const engine of env.engines) {
    assert.equal(engine.registered, true, `${engine.progId} should be registered`)
    assert.match(engine.serverPath ?? '', /wps\.exe/i)
  }
  assert.equal(env.apartmentState, 'STA')
})

test('a Writer document round-trips CJK, punctuation and emoji', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const path = join(directory, '测试文档.docx')
  const created = await wpsWriterCreateTool().execute({
    path,
    overwrite: true,
    blocks: [
      { type: 'heading', level: 1, text: '季度经营分析报告' },
      { type: 'paragraph', text: '包含「引号」、"双引号"、反斜杠\\ 与 emoji ✅ 的往返验证。' },
      { type: 'bullet', text: '营收同比增长 18.4%' },
      { type: 'numbered', text: '扩展华东渠道' },
      { type: 'table', header: true, rows: [['区域', '营收'], ['华东', '1,240']] },
    ],
  }, exec)

  assert.equal(created.blocks, 5)
  assert.ok(existsSync(path), 'the .docx must exist on disk')
  assert.ok(statSync(path).size > 5000)

  const read = await wpsWriterReadTool().execute({ path }, exec)
  assert.ok(read.text.includes('季度经营分析报告'))
  assert.ok(read.text.includes('emoji ✅'), 'emoji must survive the round trip')
  assert.ok(read.text.includes('18.4%'))
  // Rows come back as readable pipe-separated lines rather than BEL markers.
  assert.ok(!read.text.includes('\u0007'))
  assert.ok(read.text.includes('区域 | 营收'), 'table rows should render as separators')
})

test('a Writer write refuses to replace an existing file without consent', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const path = join(directory, 'protected.docx')
  await wpsWriterCreateTool().execute({ path, blocks: [{ type: 'paragraph', text: 'first' }] }, exec)
  await assert.rejects(
    () => wpsWriterCreateTool().execute({ path, blocks: [{ type: 'paragraph', text: 'second' }] }, exec),
    /already exists/,
  )
  // The original content must be untouched.
  const read = await wpsWriterReadTool().execute({ path }, exec)
  assert.ok(read.text.includes('first'))
  assert.ok(!read.text.includes('second'))
})

test('a write creates a missing parent directory', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  // WPS itself reports a bare "document save failed" for a missing folder, so
  // the tool creates it rather than surfacing that opaque error.
  const path = join(directory, 'nested', 'deep', '子目录文档.docx')
  const created = await wpsWriterCreateTool().execute({
    path,
    blocks: [{ type: 'paragraph', text: '写入不存在的子目录' }],
  }, exec)
  assert.equal(created.path, path)
  assert.ok(existsSync(path), 'the parent directory should have been created')

  const read = await wpsWriterReadTool().execute({ path }, exec)
  assert.ok(read.text.includes('写入不存在的子目录'))
})

test('append adds to an existing document instead of replacing it', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const path = join(directory, '追加.docx')
  await wpsWriterCreateTool().execute({
    path,
    blocks: [{ type: 'heading', level: 1, text: '第一章' }],
  }, exec)
  const appended = await wpsWriterCreateTool().execute({
    path,
    mode: 'append',
    blocks: [{ type: 'heading', level: 2, text: '第二章' }],
  }, exec)
  assert.equal(appended.mode, 'append')

  const read = await wpsWriterReadTool().execute({ path }, exec)
  assert.ok(read.text.includes('第一章'), 'the original section must survive')
  assert.ok(read.text.includes('第二章'))
})

test('a workbook round-trips multiple sheets and stays numeric', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const path = join(directory, '数据表.xlsx')
  const created = await wpsSheetCreateTool().execute({
    path,
    overwrite: true,
    sheets: [
      { name: '销售明细', rows: [['产品', '数量', '金额'], ['苹果', 12, 66], ['香蕉', 30, 96]] },
      { name: '汇总', rows: [['指标', '数值'], ['合计', 162]] },
    ],
  }, exec)
  assert.deepEqual(created.sheets.map(sheet => sheet.name), ['销售明细', '汇总'])

  const detail = await wpsSheetReadTool().execute({ path, sheet: '销售明细' }, exec)
  assert.equal(detail.rowCount, 3)
  assert.equal(detail.columnCount, 3)
  assert.deepEqual(detail.sheetNames, ['销售明细', '汇总'])
  assert.deepEqual(detail.rows[0], ['产品', '数量', '金额'])
  // Numbers must come back as numbers, not text.
  assert.equal(detail.rows[1][1], 12)
  assert.equal(detail.rows[1][2], 66)

  const summary = await wpsSheetReadTool().execute({ path, sheet: '汇总' }, exec)
  assert.equal(summary.rows[1][0], '合计')
})

test('a deck round-trips titles and bullet lines', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const path = join(directory, '演示文稿.pptx')
  const created = await wpsSlidesCreateTool().execute({
    path,
    overwrite: true,
    slides: [
      { title: '2026 年第三季度回顾' },
      { title: '业务亮点', bullets: ['营收 1.24 亿元', '新增客户 320 家'] },
    ],
  }, exec)
  assert.equal(created.slides, 2)

  const read = await wpsSlidesReadTool().execute({ path }, exec)
  assert.equal(read.count, 2)
  assert.ok(read.slides[0].text.join('').includes('2026 年第三季度回顾'))
  assert.ok(read.slides[1].text.join('').includes('业务亮点'))
  assert.ok(read.slides[1].text.join('').includes('新增客户 320 家'))
})

test('a document converts to PDF through the WPS engine that owns it', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const source = join(directory, '转PDF.docx')
  await wpsWriterCreateTool().execute({
    path: source,
    blocks: [{ type: 'heading', level: 1, text: 'PDF 导出验证' }],
  }, exec)

  const converted = await wpsConvertPdfTool().execute({ path: source }, exec)
  assert.equal(converted.engine, 'wps-writer')
  assert.ok(existsSync(converted.pdfPath), 'the PDF must exist on disk')
  assert.ok(statSync(converted.pdfPath).size > 1000)
  // A PDF starts with the %PDF- signature.
  const header = await import('node:fs').then(fs => fs.readFileSync(converted.pdfPath).subarray(0, 5).toString('latin1'))
  assert.equal(header, '%PDF-')
})

test('a spreadsheet converts to PDF as well', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const source = join(directory, '表转PDF.xlsx')
  await wpsSheetCreateTool().execute({
    path: source,
    sheets: [{ name: 'Sheet1', rows: [['a', 'b'], [1, 2]] }],
  }, exec)
  const converted = await wpsConvertPdfTool().execute({ path: source }, exec)
  assert.equal(converted.engine, 'wps-spreadsheets')
  assert.ok(statSync(converted.pdfPath).size > 1000)
})

test('a PDF conversion refuses to overwrite an existing PDF without consent', TIMEOUT, async (t) => {
  if (!wpsAvailable) return t.skip('WPS Office is not registered on this machine')
  const source = join(directory, '重复转换.docx')
  await wpsWriterCreateTool().execute({
    path: source,
    blocks: [{ type: 'paragraph', text: 'x' }],
  }, exec)
  await wpsConvertPdfTool().execute({ path: source }, exec)
  await assert.rejects(
    () => wpsConvertPdfTool().execute({ path: source }, exec),
    /already exists/,
  )
  // Explicit consent still works.
  const again = await wpsConvertPdfTool().execute({ path: source, overwrite: true }, exec)
  assert.ok(existsSync(again.pdfPath))
})
