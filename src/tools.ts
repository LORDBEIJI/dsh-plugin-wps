/**
 * The agent-facing WPS tool surface.
 *
 * Naming and behaviour follow the local-first convention used elsewhere in the
 * Harness: these tools drive software on this machine, they never reach out to
 * a service, and every path they take is checked before anything is written.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ContentBlock, InferArgs, InferValue, ToolRunContext } from './tool-kit.js'
import { defineTool } from './tool-kit.js'
import { WpsWorkerError, callWorker, type WorkerReply } from './bridge.js'
import {
  DEFAULT_FONT,
  assertReadable,
  assertWritable,
  cleanSlideText,
  cleanWriterText,
  defaultPdfPath,
  renderClose,
  renderConvert,
  renderEnv,
  renderOpen,
  renderQuit,
  renderSheetCreate,
  renderSheetRead,
  renderSlidesCreate,
  renderSlidesRead,
  renderWriterCreate,
  renderWriterRead,
  resolvePath,
  type CloseData,
  type ConvertData,
  type EnvData,
  type OpenData,
  type QuitData,
  type SheetCreateData,
  type SheetReadData,
  type SlidesCreateData,
  type SlidesReadData,
  type WriterCreateData,
  type WriterReadData,
} from './ops.js'

/** One text content block, the only render shape these tools emit. */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/**
 * Create the target's parent directory when it is missing.
 *
 * Writing a report into a folder that does not exist yet is the ordinary case,
 * and WPS reports it as a bare "document save failed" with no path, so the
 * directory is created here where the intent is unambiguous.
 */
function ensureParentDirectory(path: string): void {
  const parent = dirname(path)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

/** The `warnings` property every output schema carries. */
const warningsProperty = { type: 'array', items: { type: 'string' }, required: true } as const

/**
 * Build a renderer that appends collected worker warnings to a rendered body,
 * so a degraded step (a rejected sheet name, a font that would not apply) is
 * visible to the model instead of silently dropped.
 */
function withWarnings<V extends { warnings: string[] }>(body: (value: V) => string) {
  return (_args: unknown, value: V): ContentBlock[] => {
    const rendered = body(value)
    if (value.warnings.length === 0) return text(rendered)
    const notes = value.warnings.map(warning => `- ${warning}`).join('\n')
    return text(`${rendered}\nwarnings:\n${notes}`)
  }
}

/**
 * Run one worker operation, converting a failure envelope into a thrown error
 * and folding the warnings into the returned value.
 */
async function run<T extends object>(
  op: string,
  params: Record<string, unknown>,
  exec: ToolRunContext,
  timeoutMs?: number,
): Promise<T & { warnings: string[] }> {
  const reply: WorkerReply<T> = await callWorker<T>(op, params, {
    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  if (!reply.ok || reply.data === null) {
    throw new WpsWorkerError(op, reply.error ?? 'the WPS worker reported a failure without a message')
  }
  return { ...reply.data, warnings: reply.warnings ?? [] }
}

/** The block shape accepted by `wps_writer_create`. */
const blockSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['heading', 'paragraph', 'bullet', 'numbered', 'quote', 'pagebreak', 'table'],
      required: true,
    },
    text: { type: 'string' },
    level: { type: 'integer' },
    bold: { type: 'boolean' },
    align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    header: { type: 'boolean' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'json' } } },
  },
} as const

const writerCreateParameters = {
  path: { type: 'string', required: true, description: 'Absolute output path, e.g. E:\\reports\\q3.docx.' },
  blocks: { type: 'array', items: blockSpec, required: true, description: 'Document content, in order.' },
  mode: { type: 'string', enum: ['create', 'append'], description: 'create (default) writes a new document; append adds to an existing one.' },
  overwrite: { type: 'boolean', description: 'Required (true) to replace an existing file. Defaults to false.' },
  exportPdf: { type: 'boolean', description: 'Also write a PDF next to the document.' },
  openAfter: { type: 'boolean', description: 'Open the result in the visible WPS window when done.' },
  fontName: { type: 'string', description: `Body font for a new document. Defaults to ${DEFAULT_FONT}.` },
} as const

/** Report which WPS engines are installed and reachable. */
export function wpsEnvTool() {
  return defineTool({
    name: 'wps_env',
    description: 'Report the WPS Office installation on this machine: which COM automation engines are registered (Writer, Spreadsheets, Presentation), where the executable lives, and how many wps processes are running. Use this first when a WPS tool call fails for an unclear reason. It never launches WPS.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          engines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                engine: { type: 'string', required: true },
                progId: { type: 'string', required: true },
                registered: { type: 'boolean', required: true },
                serverPath: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
          runningApps: { type: 'array', items: { type: 'string' }, required: true },
          powershell: { type: 'string', required: true },
          apartmentState: { type: 'string', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<EnvData & { warnings: string[] }>(data => renderEnv(data)),
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return run<EnvData>('env', {}, exec, 60_000)
    },
  })
}

/** Create or append a Writer document. */
export function wpsWriterCreateTool() {
  return defineTool({
    name: 'wps_writer_create',
    description: 'Create a WPS Writer document (.docx) from ordered content blocks, or append blocks to an existing one. Headings, paragraphs, bulleted and numbered lists, quotes, page breaks and tables are supported, and the file is produced by driving the installed WPS through COM automation. Set exportPdf to also emit a PDF. An existing file is never replaced unless overwrite is true.',
    parameters: writerCreateParameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          blocks: { type: 'integer', required: true },
          paragraphs: { type: 'integer', required: true },
          words: { type: 'integer', required: true },
          pdfPath: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          appReused: { type: 'boolean', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<WriterCreateData & { warnings: string[] }>(data => renderWriterCreate(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      const mode = args.mode ?? 'create'
      assertWritable({ path, mode, overwrite: args.overwrite ?? false, exists: existsSync(path) })
      ensureParentDirectory(path)
      const result = await run<WriterCreateData>('writer.create', {
        path,
        mode,
        blocks: args.blocks,
        exportPdf: args.exportPdf ?? false,
        fontName: args.fontName ?? DEFAULT_FONT,
      }, exec)
      if (args.openAfter === true) await run<OpenData>('open', { path }, exec, 60_000)
      return result
    },
  })
}

/** Read text back out of a Writer document. */
export function wpsWriterReadTool() {
  return defineTool({
    name: 'wps_writer_read',
    description: 'Extract the text of a WPS Writer document (.docx/.doc) by opening it in WPS through COM. Table cells are returned as pipe-separated rows. Use it to verify what a generated document actually contains.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the document to read.' },
      maxChars: { type: 'integer', description: 'Truncate the extracted text beyond this many characters. Defaults to 200000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          text: { type: 'string', required: true },
          characters: { type: 'integer', required: true },
          paragraphs: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<WriterReadData & { warnings: string[] }>(data => renderWriterRead(data)),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertReadable(path, existsSync(path))
      const data = await run<WriterReadData>('writer.read', {
        path,
        ...(args.maxChars === undefined ? {} : { maxChars: args.maxChars }),
      }, exec, 120_000)
      // Normalize at the data layer, so the canonical value the Host stores is
      // already the readable form and no consumer has to re-clean it.
      return { ...data, text: cleanWriterText(data.text) }
    },
  })
}

/** Create a Spreadsheets workbook. */
export function wpsSheetCreateTool() {
  return defineTool({
    name: 'wps_sheet_create',
    description: 'Create a WPS Spreadsheets workbook (.xlsx) from one or more worksheets, each given as a rectangular array of rows. The first row is bolded by default and columns are auto-fitted. Values are written in one bulk assignment, so large sheets stay fast. An existing file is never replaced unless overwrite is true.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute output path, e.g. E:\\reports\\q3.xlsx.' },
      sheets: {
        type: 'array',
        required: true,
        description: 'Worksheets in order. The first one reuses the workbook default sheet.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Sheet tab name.' },
            rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'json' } }, description: 'Rows of cell values; numbers stay numeric.' },
            header: { type: 'boolean', description: 'Bold the first row. Defaults to true.' },
            autoFit: { type: 'boolean', description: 'Auto-fit column widths. Defaults to true.' },
            freezeHeader: { type: 'boolean', description: 'Freeze the first row. Defaults to false.' },
          },
        },
      },
      overwrite: { type: 'boolean', description: 'Required (true) to replace an existing file. Defaults to false.' },
      openAfter: { type: 'boolean', description: 'Open the result in the visible WPS window when done.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          sheets: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string', required: true }, rows: { type: 'integer', required: true } },
            },
          },
          appReused: { type: 'boolean', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<SheetCreateData & { warnings: string[] }>(data => renderSheetCreate(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertWritable({ path, mode: 'create', overwrite: args.overwrite ?? false, exists: existsSync(path) })
      ensureParentDirectory(path)
      const result = await run<SheetCreateData>('sheet.create', { path, sheets: args.sheets }, exec)
      if (args.openAfter === true) await run<OpenData>('open', { path }, exec, 60_000)
      return result
    },
  })
}

/** Read values out of a workbook. */
export function wpsSheetReadTool() {
  return defineTool({
    name: 'wps_sheet_read',
    description: 'Read the used range of a WPS Spreadsheets workbook (.xlsx/.xls) as a grid of cell values, returned as tab-separated rows. Defaults to the first worksheet; pass sheet to choose another. Large sheets are truncated to maxRows by maxColumns.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the workbook.' },
      sheet: { type: 'string', description: 'Worksheet name. Defaults to the first sheet.' },
      maxRows: { type: 'integer', description: 'Row cap. Defaults to 5000.' },
      maxColumns: { type: 'integer', description: 'Column cap. Defaults to 200.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          sheet: { type: 'string', required: true },
          sheetNames: { type: 'array', items: { type: 'string' }, required: true },
          rowCount: { type: 'integer', required: true },
          columnCount: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'json' } } },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<SheetReadData & { warnings: string[] }>(data => renderSheetRead(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertReadable(path, existsSync(path))
      return run<SheetReadData>('sheet.read', {
        path,
        ...(args.sheet === undefined ? {} : { sheet: args.sheet }),
        ...(args.maxRows === undefined ? {} : { maxRows: args.maxRows }),
        ...(args.maxColumns === undefined ? {} : { maxColumns: args.maxColumns }),
      }, exec, 120_000)
    },
  })
}

/** Create a Presentation deck. */
export function wpsSlidesCreateTool() {
  return defineTool({
    name: 'wps_slides_create',
    description: 'Create a WPS Presentation deck (.pptx) from slides, each with a title and optional bullet lines, driving the installed WPS through COM. A slide with a title and bullets uses the title-and-content layout; a title alone uses the title layout. An existing file is never replaced unless overwrite is true.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute output path, e.g. E:\\reports\\deck.pptx.' },
      slides: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      overwrite: { type: 'boolean', description: 'Required (true) to replace an existing file. Defaults to false.' },
      openAfter: { type: 'boolean', description: 'Open the result in the visible WPS window when done.' },
      fontName: { type: 'string', description: `Font for titles and body text. Defaults to ${DEFAULT_FONT}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          slides: { type: 'integer', required: true },
          appReused: { type: 'boolean', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<SlidesCreateData & { warnings: string[] }>(data => renderSlidesCreate(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertWritable({ path, mode: 'create', overwrite: args.overwrite ?? false, exists: existsSync(path) })
      ensureParentDirectory(path)
      const result = await run<SlidesCreateData>('slides.create', {
        path,
        slides: args.slides,
        fontName: args.fontName ?? DEFAULT_FONT,
      }, exec)
      if (args.openAfter === true) await run<OpenData>('open', { path }, exec, 60_000)
      return result
    },
  })
}

/** Read back slide text. */
export function wpsSlidesReadTool() {
  return defineTool({
    name: 'wps_slides_read',
    description: 'Extract the text of every slide in a WPS Presentation deck (.pptx/.ppt) by opening it in WPS through COM. Use it to verify a generated deck.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the deck.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          slides: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                text: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<SlidesReadData & { warnings: string[] }>(data => renderSlidesRead(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertReadable(path, existsSync(path))
      const data = await run<SlidesReadData>('slides.read', { path }, exec, 120_000)
      return {
        ...data,
        slides: data.slides.map(slide => ({ ...slide, text: slide.text.map(cleanSlideText) })),
      }
    },
  })
}

/** Convert an Office file to PDF through WPS. */
export function wpsConvertPdfTool() {
  return defineTool({
    name: 'wps_convert_pdf',
    description: 'Convert a WPS/Office file (.docx, .doc, .xlsx, .xls, .pptx, .ppt) to PDF using the locally installed WPS engine that owns that format, so layout matches what the user sees in WPS. The PDF path defaults to the source file with a .pdf extension. The source file is opened read-only and never modified.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the source document.' },
      outPath: { type: 'string', description: 'Absolute path for the PDF. Defaults to the source path with a .pdf extension.' },
      overwrite: { type: 'boolean', description: 'Required (true) if the PDF already exists.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          pdfPath: { type: 'string', required: true },
          engine: { type: 'string', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<ConvertData & { warnings: string[] }>(data => renderConvert(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertReadable(path, existsSync(path))
      // Resolve the default target here rather than in the worker, so the
      // overwrite guard below covers the implicit path too.
      const outPath = args.outPath === undefined ? defaultPdfPath(path) : resolvePath(args.outPath)
      assertWritable({
        path: outPath,
        mode: 'create',
        overwrite: args.overwrite ?? false,
        exists: existsSync(outPath),
      })
      ensureParentDirectory(outPath)
      return run<ConvertData>('convert.pdf', { path, outPath }, exec, 240_000)
    },
  })
}

/** Open a file in the user's visible WPS. */
export function wpsOpenTool() {
  return defineTool({
    name: 'wps_open',
    description: 'Open a document in the visible WPS window on this machine so the user can see it. Use it when the user should look at a file rather than receive a path. This makes the WPS window visible and leaves the document open when the call returns.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the file to open.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          app: { type: 'string', required: true },
          appReused: { type: 'boolean', required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<OpenData & { warnings: string[] }>(data => renderOpen(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      assertReadable(path, existsSync(path))
      return run<OpenData>('open', { path }, exec, 120_000)
    },
  })
}

/** Close a document the agent opened. */
export function wpsCloseTool() {
  return defineTool({
    name: 'wps_close',
    description: 'Close a document that is currently open in WPS, discarding unsaved changes. Only the named file is closed; other documents in the same WPS window are untouched. Prefer this over wps_quit when the user may still be working in WPS.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the open document to close.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          closed: { type: 'array', items: { type: 'string' }, required: true },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<CloseData & { warnings: string[] }>(data => renderClose(data)),
    },
    async execute(args, exec) {
      const path = resolvePath(args.path)
      return run<CloseData>('close', { path }, exec, 60_000)
    },
  })
}

/** Release automation instances. */
export function wpsQuitTool() {
  return defineTool({
    name: 'wps_quit',
    description: 'Release the WPS automation instances this plugin started, freeing the memory they hold. By default an instance is closed only when it has no open document, so a session the user is working in is never closed. Pass force: true only when you know every open document in WPS is disposable.',
    parameters: {
      force: { type: 'boolean', description: 'Close instances even when they hold open documents. This can discard unsaved user work; defaults to false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                engine: { type: 'string', required: true },
                connected: { type: 'boolean', required: true },
                quit: { type: 'boolean', required: true },
                openDocuments: { type: 'integer', required: true },
                skippedReason: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
          warnings: warningsProperty,
        },
      },
      render: withWarnings<QuitData & { warnings: string[] }>(data => renderQuit(data)),
    },
    async execute(args, exec) {
      return run<QuitData>('quit', { force: args.force ?? false }, exec, 60_000)
    },
  })
}

/** Every tool this plugin registers, in prompt order. */
export function wpsTools(): ReturnType<typeof wpsEnvTool>[] {
  return [
    wpsEnvTool(),
    wpsWriterCreateTool(),
    wpsWriterReadTool(),
    wpsSheetCreateTool(),
    wpsSheetReadTool(),
    wpsSlidesCreateTool(),
    wpsSlidesReadTool(),
    wpsConvertPdfTool(),
    wpsOpenTool(),
    wpsCloseTool(),
    wpsQuitTool(),
  ]
}

/** Tool names, for the system-prompt announcement. */
export const WPS_TOOL_NAMES = [
  'wps_env',
  'wps_writer_create',
  'wps_writer_read',
  'wps_sheet_create',
  'wps_sheet_read',
  'wps_slides_create',
  'wps_slides_read',
  'wps_convert_pdf',
  'wps_open',
  'wps_close',
  'wps_quit',
] as const

/** Re-exported for tests that exercise the inferred argument types. */
export type { InferArgs, InferValue }
