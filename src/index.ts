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

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { WPS_TOOL_NAMES, wpsTools } from './tools.js'

/** Stable cordis plugin name. */
export const name = 'wps'

/** The tool registry must exist before the WPS tools can register. */
export const inject = ['tools']

/** Prompt-section order: after the core surfaces, beside other tool plugins. */
const SECTION_ORDER = 120

/**
 * Plugin config as a profile patch declares it.
 *
 * Deliberately permissive: the loader fills in defaults and calls `apply`, so a
 * missing field must never fail activation.
 */
export interface Config {
  /** Master switch for the plugin. Defaults to on. */
  enabled?: boolean
  /**
   * When true, a system-prompt section tells every agent that WPS document
   * tools are available. Defaults to on; the section renders only while at
   * least one WPS tool is actually reachable.
   */
  announceToAgent?: boolean
}

/** Guidance text, rendered only when a WPS tool is visible to the agent. */
const GUIDANCE = [
  'WPS Office on this machine is available through the wps_* tools:',
  'create Writer documents (wps_writer_create), workbooks (wps_sheet_create)',
  'and slide decks (wps_slides_create); read them back with the matching',
  'wps_*_read tools; export PDF with wps_convert_pdf; and show a file to the',
  'user in their own WPS window with wps_open.',
  'Every write needs an explicit overwrite: true to replace an existing file.',
].join(' ')

/**
 * Mount the WPS tool surface.
 * @param ctx - the plugin context.
 * @param config - profile configuration, filled from schema defaults.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  ctx.effect(() => {
    const disposers = wpsTools().map(tool => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-wps: tools')

  if (config.announceToAgent === false) return

  // Optional surface: a composition without the system-prompt service still
  // gets the tools, just without the announcement.
  const prompt = ctx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: string }): () => void }
    | undefined
  if (prompt === undefined) return

  ctx.effect(() => prompt.section({
    name: 'plugin:dsh-wps',
    order: SECTION_ORDER,
    // The announcement names the wps_* tools, so it must disappear together
    // with them when a restriction hides the surface.
    text: WPS_TOOL_NAMES.some(tool => ctx.tools.get(tool) !== undefined) ? GUIDANCE : '',
  }), 'dsh-wps: prompt section')
}
