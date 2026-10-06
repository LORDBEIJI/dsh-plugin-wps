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
/** Absolute path of the worker script shipped beside the compiled output. */
export declare const WORKER_SCRIPT: string;
/** A generous default: a cold WPS start plus a save can take seconds. */
export declare const DEFAULT_TIMEOUT_MS = 180000;
/** The worker's reply envelope. */
export interface WorkerReply<T> {
    ok: boolean;
    op: string | null;
    data: T | null;
    warnings: string[];
    error: string | null;
}
/** A worker call that could not produce a usable reply. */
export declare class WpsWorkerError extends Error {
    readonly op: string;
    readonly detail: string | null;
    constructor(op: string, message: string, detail?: string | null);
}
/** Options for one worker call. */
export interface WorkerCallOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
/**
 * Invoke one worker operation.
 * @param op - the operation name the worker dispatches on.
 * @param params - operation parameters (serialized as UTF-8 JSON).
 * @param options - cancellation and timeout.
 * @returns the worker's reply envelope.
 * @throws {WpsWorkerError} when no usable reply could be read.
 */
export declare function callWorker<T = unknown>(op: string, params: Record<string, unknown>, options?: WorkerCallOptions): Promise<WorkerReply<T>>;
//# sourceMappingURL=bridge.d.ts.map