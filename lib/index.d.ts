/**
 * dsh-wps - host half.
 *
 * Registers the agent-facing WPS Office tool surface. Every tool drives the
 * WPS installation on this machine through COM automation, so the files a user
 * gets are produced by the same engine that will open them.
 *
 * The plugin has no runtime dependency on any `@deepseek-ai/*` module: the
 * imports below are type-only and erased at build time, which keeps the package
 * loadable from a plain linked directory.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Stable cordis plugin name. */
export declare const name = "wps";
/** The tool registry must exist before the WPS tools can register. */
export declare const inject: string[];
/**
 * Plugin config as a profile patch declares it.
 *
 * Deliberately permissive: the loader fills in defaults and calls `apply`, so a
 * missing field must never fail activation.
 */
export interface Config {
    /** Master switch for the plugin. Defaults to on. */
    enabled?: boolean;
    /**
     * When true, a system-prompt section tells every agent that WPS document
     * tools are available. Defaults to on; the section renders only while at
     * least one WPS tool is actually reachable.
     */
    announceToAgent?: boolean;
}
/**
 * Mount the WPS tool surface.
 * @param ctx - the plugin context.
 * @param config - profile configuration, filled from schema defaults.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map