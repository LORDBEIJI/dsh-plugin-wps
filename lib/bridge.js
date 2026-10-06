/**
 * Node-side bridge to the PowerShell COM worker.
 *
 * Each call writes one UTF-8 JSON request file, runs the worker as a fresh
 * `powershell.exe` process, and reads the UTF-8 JSON response file back. Files
 * rather than pipes carry the payload, which sidesteps console code-page
 * negotiation entirely: CJK text round-trips byte-exact.
 *
 * Calls are serialized. COM automation servers are single-threaded apartments,
 * so overlapping calls would interleave inside one WPS instance; a promise
 * chain keeps exactly one worker process alive at a time.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Absolute path of the worker script shipped beside the compiled output. */
export const WORKER_SCRIPT = fileURLToPath(new URL('../scripts/wps-worker.ps1', import.meta.url));
/** The shell used to host COM. Windows PowerShell 5.1 is STA by default. */
const POWERSHELL = process.env.DSH_WPS_POWERSHELL ?? 'powershell.exe';
/** A generous default: a cold WPS start plus a save can take seconds. */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** A worker call that could not produce a usable reply. */
export class WpsWorkerError extends Error {
    op;
    detail;
    constructor(op, message, detail = null) {
        super(message);
        this.name = 'WpsWorkerError';
        this.op = op;
        this.detail = detail;
    }
}
let queueTail = Promise.resolve();
/** Run one task after every previously enqueued task has settled. */
function enqueue(task) {
    const result = queueTail.then(task, task);
    // Keep the chain alive regardless of individual outcomes.
    queueTail = result.then(() => undefined, () => undefined);
    return result;
}
/**
 * Invoke one worker operation.
 * @param op - the operation name the worker dispatches on.
 * @param params - operation parameters (serialized as UTF-8 JSON).
 * @param options - cancellation and timeout.
 * @returns the worker's reply envelope.
 * @throws {WpsWorkerError} when no usable reply could be read.
 */
export function callWorker(op, params, options = {}) {
    return enqueue(() => runWorker(op, params, options));
}
async function runWorker(op, params, options) {
    if (options.signal?.aborted === true)
        throw new WpsWorkerError(op, 'cancelled before the call started');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const directory = await mkdtemp(join(tmpdir(), 'dsh-wps-'));
    const requestPath = join(directory, 'request.json');
    const responsePath = join(directory, 'response.json');
    try {
        await writeFile(requestPath, JSON.stringify({ op, params: params ?? {} }), 'utf8');
        const failure = await runProcess(op, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', WORKER_SCRIPT,
            '-RequestPath', requestPath,
            '-ResponsePath', responsePath,
        ], timeoutMs, options.signal);
        let raw;
        try {
            raw = await readFile(responsePath, 'utf8');
        }
        catch {
            throw new WpsWorkerError(op, failure ?? 'the worker produced no response file', failure);
        }
        // Windows PowerShell writes UTF-8 with a BOM; JSON.parse rejects it.
        const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
        try {
            return JSON.parse(text);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new WpsWorkerError(op, `the worker response was not valid JSON: ${reason}`, text.slice(0, 2000));
        }
    }
    finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
}
/**
 * Run the worker process to completion.
 * @returns a diagnostic message when the process failed, or null on success.
 */
function runProcess(op, args, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        const child = spawn(POWERSHELL, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stderr = '';
        let settled = false;
        const finish = (action) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            action();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(() => reject(new WpsWorkerError(op, `the WPS worker timed out after ${timeoutMs} ms`)));
        }, timeoutMs);
        const onAbort = () => {
            child.kill();
            finish(() => reject(new WpsWorkerError(op, 'cancelled')));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
            if (stderr.length < 8000)
                stderr += chunk;
        });
        child.on('error', (error) => {
            finish(() => reject(new WpsWorkerError(op, `could not start ${POWERSHELL}: ${error.message}`)));
        });
        child.on('close', (code) => {
            if (code === 0) {
                finish(() => resolve(null));
                return;
            }
            const detail = stderr.trim() === '' ? `exit code ${code}` : `exit code ${code}: ${stderr.trim()}`;
            // A non-zero exit still may have written a structured failure envelope,
            // so the caller reads the response file first and only reports this when
            // that file is unusable.
            finish(() => resolve(detail));
        });
    });
}
//# sourceMappingURL=bridge.js.map