/**
 * Domain logic shared by every tool: argument-to-request mapping, the
 * write-safety checks, and the model-facing renderers.
 *
 * Everything here is pure (it takes `exists` as a fact rather than touching the
 * filesystem), so the interesting behaviour is unit-testable without WPS.
 */
import { extname, isAbsolute, normalize, resolve } from 'node:path';
/** Default CJK font applied to generated documents and slides. */
export const DEFAULT_FONT = '微软雅黑';
/** A caller mistake: bad path, missing file, refusing to overwrite. */
export class WpsUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WpsUsageError';
    }
}
// --- paths and write safety ------------------------------------------------
/**
 * Resolve a model-supplied path against the host process working directory.
 * @param input - absolute or relative path.
 * @returns the normalized absolute path.
 */
export function resolvePath(input) {
    const trimmed = input.trim();
    if (trimmed === '')
        throw new WpsUsageError('path must not be empty');
    return isAbsolute(trimmed) ? normalize(trimmed) : resolve(process.cwd(), trimmed);
}
/**
 * Refuse a write that would silently destroy an existing file.
 *
 * Overwriting is the one irreversible thing these tools can do, so it always
 * requires an explicit `overwrite: true` from the caller.
 * @param intent - the target path and caller intent.
 * @throws {WpsUsageError} when the write would clobber a file without consent.
 */
export function assertWritable(intent) {
    if (intent.mode === 'append') {
        if (!intent.exists) {
            throw new WpsUsageError(`cannot append: ${intent.path} does not exist. Use mode "create" to make a new document.`);
        }
        return;
    }
    if (intent.exists && !intent.overwrite) {
        throw new WpsUsageError(`${intent.path} already exists. Pass overwrite: true to replace it, choose another path, `
            + 'or use the read tool to inspect it first.');
    }
}
/**
 * Require that a source file exists before an operation reads it.
 * @param path - the resolved path.
 * @param exists - whether the file exists.
 * @throws {WpsUsageError} when the file is missing.
 */
export function assertReadable(path, exists) {
    if (!exists)
        throw new WpsUsageError(`${path} does not exist`);
}
/**
 * The PDF path a conversion produces when the caller names none.
 *
 * Resolved in Node rather than delegated to the worker, so the same overwrite
 * check that guards every other write also covers the default target.
 * @param sourcePath - resolved absolute source path.
 * @returns the sibling path with a `.pdf` extension.
 */
export function defaultPdfPath(sourcePath) {
    const extension = extname(sourcePath);
    return `${sourcePath.slice(0, sourcePath.length - extension.length)}.pdf`;
}
/**
 * Normalize text extracted from a slide.
 * @param text - raw PowerPoint text.
 * @returns LF-terminated text without surrounding whitespace.
 */
export function cleanSlideText(text) {
    return text.replace(/\r\n?/g, '\n').trim();
}
// --- renderers -------------------------------------------------------------
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
export function cleanWriterText(text) {
    return text
        .replace(/\r\u0007\r\u0007/g, '\n')
        .replace(/\r\u0007/g, ' | ')
        .replace(/\r\n?/g, '\n')
        .replace(/\u0007/g, ' | ')
        .replace(/[ \t]*\|[ \t]*/g, ' | ')
        .replace(/(?: \| )+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Render a grid as tab-separated lines, the most compact form for a model. */
export function renderGrid(rows) {
    return rows
        .map(row => row
        .map((cell) => {
        if (cell === null || cell === undefined)
            return '';
        return String(cell).replace(/[\t\r\n]+/g, ' ');
    })
        .join('\t'))
        .join('\n');
}
/** Render the installed-engine report. */
export function renderEnv(data) {
    const lines = data.engines.map((engine) => {
        const state = engine.registered ? 'available' : 'NOT REGISTERED';
        const path = engine.serverPath === null ? '' : `\n    ${engine.serverPath}`;
        return `- ${engine.engine} (${engine.progId}): ${state}${path}`;
    });
    return [
        'WPS Office COM engines:',
        ...lines,
        `PowerShell: ${data.powershell} (${data.apartmentState})`,
        `Running wps/et/wpp processes: ${data.runningApps.length === 0 ? 'none' : data.runningApps.join(', ')}`,
    ].join('\n');
}
/** Render a created/updated Writer document. */
export function renderWriterCreate(data) {
    const parts = [
        `saved ${data.path}`,
        `${data.blocks} block(s), ${data.paragraphs} paragraph(s), ${data.words} word(s)`,
        data.mode === 'append' ? 'mode: append' : 'mode: create',
    ];
    if (data.pdfPath !== null)
        parts.push(`pdf: ${data.pdfPath}`);
    return parts.join('\n');
}
/** Render extracted Writer text. */
export function renderWriterRead(data) {
    const header = `${data.path} (${data.characters} characters, ${data.paragraphs} paragraphs`
        + `${data.truncated ? ', truncated' : ''})`;
    return `${header}\n---\n${data.text}`;
}
/** Render a created workbook. */
export function renderSheetCreate(data) {
    const sheets = data.sheets.map(sheet => `${sheet.name || '(unnamed)'} [${sheet.rows} row(s)]`).join(', ');
    return `saved ${data.path}\nsheets: ${sheets}`;
}
/** Render extracted worksheet values. */
export function renderSheetRead(data) {
    const header = `${data.path} sheet "${data.sheet}" `
        + `(${data.rowCount}x${data.columnCount}${data.truncated ? ', truncated' : ''})`
        + `\navailable sheets: ${data.sheetNames.join(', ')}`;
    return `${header}\n---\n${renderGrid(data.rows)}`;
}
/** Render a created presentation. */
export function renderSlidesCreate(data) {
    return `saved ${data.path}\n${data.slides} slide(s)`;
}
/** Render extracted slide text. */
export function renderSlidesRead(data) {
    const body = data.slides
        .map(slide => `#${slide.index}\n${slide.text.join('\n')}`)
        .join('\n\n');
    return `${data.path} (${data.count} slide(s))\n---\n${body}`;
}
/** Render a PDF conversion. */
export function renderConvert(data) {
    return `converted ${data.path} -> ${data.pdfPath} (${data.engine})`;
}
/** Render an open-in-WPS result. */
export function renderOpen(data) {
    return `opened ${data.path} in ${data.app}${data.appReused ? ' (existing window)' : ''}`;
}
/** Render a close result. */
export function renderClose(data) {
    if (data.closed.length === 0)
        return `${data.path} was not open; nothing closed`;
    return `closed ${data.closed.join(', ')}`;
}
/** Render the automation-instance cleanup report. */
export function renderQuit(data) {
    if (data.results.length === 0)
        return 'no automation instances were found';
    return data.results
        .map((result) => {
        if (!result.connected)
            return `- ${result.engine}: not running under automation`;
        if (result.quit)
            return `- ${result.engine}: closed`;
        return `- ${result.engine}: left running (${result.skippedReason ?? 'kept'})`;
    })
        .join('\n');
}
//# sourceMappingURL=ops.js.map