/**
 * Domain logic shared by every tool: argument-to-request mapping, the
 * write-safety checks, and the model-facing renderers.
 *
 * Everything here is pure (it takes `exists` as a fact rather than touching the
 * filesystem), so the interesting behaviour is unit-testable without WPS.
 */
import type { JsonValue } from './json-schema.js';
/** Default CJK font applied to generated documents and slides. */
export declare const DEFAULT_FONT = "\u5FAE\u8F6F\u96C5\u9ED1";
/** A caller mistake: bad path, missing file, refusing to overwrite. */
export declare class WpsUsageError extends Error {
    constructor(message: string);
}
/** One entry of the generated-document content model. */
export interface ContentBlock {
    type: 'heading' | 'paragraph' | 'bullet' | 'numbered' | 'quote' | 'pagebreak' | 'table';
    text?: string;
    level?: number;
    bold?: boolean;
    align?: 'left' | 'center' | 'right' | 'justify';
    header?: boolean;
    rows?: JsonValue[][];
}
/** One worksheet definition. */
export interface SheetSpec {
    name?: string;
    header?: boolean;
    autoFit?: boolean;
    freezeHeader?: boolean;
    rows: JsonValue[][];
}
/** One slide definition. */
export interface SlideSpec {
    title?: string;
    bullets?: string[];
}
/**
 * Resolve a model-supplied path against the host process working directory.
 * @param input - absolute or relative path.
 * @returns the normalized absolute path.
 */
export declare function resolvePath(input: string): string;
/** The facts a write-safety decision depends on. */
export interface WriteIntent {
    path: string;
    /** `append` continues an existing document; `create` starts a new one. */
    mode: 'create' | 'append';
    /** Whether the caller explicitly allowed replacing an existing file. */
    overwrite: boolean;
    /** Whether the target already exists on disk. */
    exists: boolean;
}
/**
 * Refuse a write that would silently destroy an existing file.
 *
 * Overwriting is the one irreversible thing these tools can do, so it always
 * requires an explicit `overwrite: true` from the caller.
 * @param intent - the target path and caller intent.
 * @throws {WpsUsageError} when the write would clobber a file without consent.
 */
export declare function assertWritable(intent: WriteIntent): void;
/**
 * Require that a source file exists before an operation reads it.
 * @param path - the resolved path.
 * @param exists - whether the file exists.
 * @throws {WpsUsageError} when the file is missing.
 */
export declare function assertReadable(path: string, exists: boolean): void;
/**
 * The PDF path a conversion produces when the caller names none.
 *
 * Resolved in Node rather than delegated to the worker, so the same overwrite
 * check that guards every other write also covers the default target.
 * @param sourcePath - resolved absolute source path.
 * @returns the sibling path with a `.pdf` extension.
 */
export declare function defaultPdfPath(sourcePath: string): string;
/**
 * Normalize text extracted from a slide.
 * @param text - raw PowerPoint text.
 * @returns LF-terminated text without surrounding whitespace.
 */
export declare function cleanSlideText(text: string): string;
/** One installed engine as reported by the `env` operation. */
export interface EnvEngine {
    engine: string;
    progId: string;
    registered: boolean;
    serverPath: string | null;
}
/** The `env` operation's payload. */
export interface EnvData {
    engines: EnvEngine[];
    runningApps: string[];
    powershell: string;
    apartmentState: string;
}
/** The `writer.create` payload. */
export interface WriterCreateData {
    path: string;
    mode: string;
    blocks: number;
    paragraphs: number;
    words: number;
    pdfPath: string | null;
    appReused: boolean;
}
/** The `writer.read` payload. */
export interface WriterReadData {
    path: string;
    text: string;
    characters: number;
    paragraphs: number;
    truncated: boolean;
}
/** The `sheet.create` payload. */
export interface SheetCreateData {
    path: string;
    sheets: {
        name: string;
        rows: number;
    }[];
    appReused: boolean;
}
/** The `sheet.read` payload. */
export interface SheetReadData {
    path: string;
    sheet: string;
    sheetNames: string[];
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    rows: JsonValue[][];
}
/** The `slides.create` payload. */
export interface SlidesCreateData {
    path: string;
    slides: number;
    appReused: boolean;
}
/** The `slides.read` payload. */
export interface SlidesReadData {
    path: string;
    slides: {
        index: number;
        text: string[];
    }[];
    count: number;
}
/** The `convert.pdf` payload. */
export interface ConvertData {
    path: string;
    pdfPath: string;
    engine: string;
}
/** The `open` payload. */
export interface OpenData {
    path: string;
    app: string;
    appReused: boolean;
}
/** The `close` payload. */
export interface CloseData {
    path: string;
    closed: string[];
}
/** One engine's outcome in the `quit` payload. */
export interface QuitResult {
    engine: string;
    connected: boolean;
    quit: boolean;
    openDocuments: number;
    skippedReason: string | null;
}
/** The `quit` payload. */
export interface QuitData {
    results: QuitResult[];
}
/**
 * Normalize text extracted from a Writer document.
 *
 * Word marks the end of a table cell with CR+U+0007 and repeats that marker to
 * end a row (observed on real WPS output as `cell\r\u0007cell\r\u0007\r\u0007`).
 * Rows are therefore collapsed first, then remaining markers become separators,
 * which turns a table into readable pipe-separated lines.
 * @param text - raw `Content.Text` output.
 * @returns normalized plain text.
 */
export declare function cleanWriterText(text: string): string;
/** Render a grid as tab-separated lines, the most compact form for a model. */
export declare function renderGrid(rows: JsonValue[][]): string;
/** Render the installed-engine report. */
export declare function renderEnv(data: EnvData): string;
/** Render a created/updated Writer document. */
export declare function renderWriterCreate(data: WriterCreateData): string;
/** Render extracted Writer text. */
export declare function renderWriterRead(data: WriterReadData): string;
/** Render a created workbook. */
export declare function renderSheetCreate(data: SheetCreateData): string;
/** Render extracted worksheet values. */
export declare function renderSheetRead(data: SheetReadData): string;
/** Render a created presentation. */
export declare function renderSlidesCreate(data: SlidesCreateData): string;
/** Render extracted slide text. */
export declare function renderSlidesRead(data: SlidesReadData): string;
/** Render a PDF conversion. */
export declare function renderConvert(data: ConvertData): string;
/** Render an open-in-WPS result. */
export declare function renderOpen(data: OpenData): string;
/** Render a close result. */
export declare function renderClose(data: CloseData): string;
/** Render the automation-instance cleanup report. */
export declare function renderQuit(data: QuitData): string;
//# sourceMappingURL=ops.d.ts.map