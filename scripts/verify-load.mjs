/**
 * Verify the plugin loads and works from the exact path the Host resolves.
 *
 * The Host loads the package through the profile's node_modules link, not from
 * this source directory, so this script exercises that path: it imports the
 * entry through the link, runs `apply` against a minimal context, resolves the
 * worker script, and performs one real WPS call. Module-resolution problems
 * that running from the source tree would hide (a mis-resolved worker path, for
 * instance) surface here.
 *
 * Usage:
 *   node scripts/verify-load.mjs "<profile>/node_modules/dsh-wps"
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const link = process.argv[2]
if (link === undefined || link === '') {
  console.error('usage: node scripts/verify-load.mjs <profile-node_modules-link>')
  process.exit(2)
}

const base = pathToFileURL(link.replace(/\\/g, '/').replace(/\/+$/, '') + '/')
const { apply, inject, name } = await import(new URL('lib/index.js', base).href)
const { WORKER_SCRIPT } = await import(new URL('lib/bridge.js', base).href)

console.log(`plugin name:   ${name}`)
console.log(`inject:        ${JSON.stringify(inject)}`)
console.log(`worker script: ${WORKER_SCRIPT}`)

if (!existsSync(WORKER_SCRIPT)) {
  console.error('FAIL: the worker script does not resolve from the loaded entry')
  process.exit(1)
}

const registered = []
const context = {
  effect: factory => factory(),
  tools: {
    register(tool) {
      registered.push(tool)
      return () => {
        const index = registered.indexOf(tool)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    get(toolName) {
      return registered.find(tool => tool.name === toolName)
    },
  },
  get: () => undefined,
}

apply(context, {})
console.log(`tools registered: ${registered.length}`)
if (registered.length !== 11) {
  console.error('FAIL: expected 11 tools')
  process.exit(1)
}

const env = registered.find(tool => tool.name === 'wps_env')
const result = await env.execute({}, { signal: new AbortController().signal })
const engines = result.engines
  .map(engine => `${engine.engine}=${engine.registered ? 'ok' : 'missing'}`)
  .join(', ')

console.log(`wps_env through the link: ${engines}`)
if (!result.engines.every(engine => engine.registered)) {
  console.error('FAIL: an engine is not registered')
  process.exit(1)
}

console.log('OK: the plugin loads and drives WPS from the Host-resolved path')
