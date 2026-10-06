// The plugin entry: what `apply` registers on a Cordis context, and when the
// system-prompt announcement appears. Uses a minimal fake context so the entry
// contract is pinned without booting a Host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../lib/index.js'

const EXPECTED_TOOLS = [
  'wps_close',
  'wps_convert_pdf',
  'wps_env',
  'wps_open',
  'wps_quit',
  'wps_sheet_create',
  'wps_sheet_read',
  'wps_slides_create',
  'wps_slides_read',
  'wps_writer_create',
  'wps_writer_read',
]

function createContext({ systemPrompt = true } = {}) {
  const registered = []
  const sections = []
  const context = {
    effect(factory) {
      return factory()
    },
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
    get(service) {
      if (service === 'systemPrompt' && systemPrompt) {
        return {
          section(section) {
            sections.push(section)
            return () => {}
          },
        }
      }
      return undefined
    },
  }
  return { context, registered, sections }
}

test('the plugin declares a stable name and its hard dependency', () => {
  assert.equal(name, 'wps')
  assert.deepEqual(inject, ['tools'])
})

test('apply registers exactly the expected tool surface', () => {
  const { context, registered } = createContext()
  apply(context, {})
  assert.deepEqual(registered.map(tool => tool.name).sort(), EXPECTED_TOOLS)
})

test('every registered tool carries a compiled parameter object', () => {
  const { context, registered } = createContext()
  apply(context, {})
  for (const tool of registered) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(tool.output.schema.type, 'object')
  }
})

test('disposing the effects unregisters every tool', () => {
  const { context, registered } = createContext()
  const disposers = []
  context.effect = (factory) => {
    const disposer = factory()
    disposers.push(disposer)
    return disposer
  }
  apply(context, {})
  assert.equal(registered.length, 11)
  // apply installs two effects (tools, prompt section), so every disposer runs.
  for (const dispose of disposers) dispose()
  assert.equal(registered.length, 0)
})

test('enabled false registers nothing', () => {
  const { context, registered, sections } = createContext()
  apply(context, { enabled: false })
  assert.equal(registered.length, 0)
  assert.equal(sections.length, 0)
})

test('the announcement renders once a WPS tool is reachable', () => {
  const { context, sections } = createContext()
  apply(context, {})
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'plugin:dsh-wps')
  assert.match(sections[0].text, /wps_writer_create/)
  assert.match(sections[0].text, /wps_convert_pdf/)
})

test('a missing system-prompt service never blocks tool registration', () => {
  const { context, registered, sections } = createContext({ systemPrompt: false })
  apply(context, {})
  assert.equal(registered.length, 11)
  assert.equal(sections.length, 0)
})

test('announceToAgent false suppresses only the announcement', () => {
  const { context, registered, sections } = createContext()
  apply(context, { announceToAgent: false })
  assert.equal(registered.length, 11)
  assert.equal(sections.length, 0)
})

test('a default config object is not required', () => {
  const { context, registered } = createContext()
  apply(context)
  assert.equal(registered.length, 11)
})
