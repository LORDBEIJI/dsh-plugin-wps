// Parity oracle: the plugin's dependency-free schema compiler and validator are
// compared against the official SDK implementation. Any drift between the two
// fails here rather than at runtime inside the Host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertSupportedJsonSchema,
  defineTool as officialDefineTool,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools'
import { compileParameterSchema, compileValueSchema, validateAgainstSchema } from '../lib/json-schema.js'
import { wpsTools } from '../lib/tools.js'

// A spec that exercises every author-facing feature the plugin uses.
const parameterSpec = {
  text: { type: 'string', required: true, description: 'Text' },
  count: { type: 'integer' },
  ratio: { type: 'number' },
  tags: { type: 'array', items: { type: 'string' }, required: true },
  mode: { type: 'string', enum: ['create', 'append'], required: true },
  opt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
  nested: {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'string', required: true }, b: { type: 'integer' } },
    required: true,
  },
  blocks: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['heading', 'paragraph'], required: true },
        text: { type: 'string' },
        rows: { type: 'array', items: { type: 'array', items: { type: 'json' } } },
      },
    },
  },
  flag: { type: 'boolean', required: true },
  plain: { type: 'boolean' },
}

const outputSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { n: { type: 'string', required: true }, v: { type: 'json' } },
      },
    },
    note: { type: 'string' },
  },
}

function officialTool(parameters, schema) {
  return officialDefineTool({
    name: 'parity',
    description: 'parity probe',
    parameters,
    output: { schema, render: () => [] },
    async execute() { return { ok: true, items: [] } },
  })
}

test('parameter compilation is identical to the official compiler', () => {
  const official = officialTool(parameterSpec, outputSpec)
  assert.deepStrictEqual(compileParameterSchema(parameterSpec), official.parameters)
})

test('value compilation is identical to the official compiler', () => {
  const official = officialTool(parameterSpec, outputSpec)
  assert.deepStrictEqual(compileValueSchema(outputSpec, 'output.schema'), official.output.schema)
})

test('the parameter root stays implicitly open, as the official compiler emits it', () => {
  const compiled = compileParameterSchema({ a: { type: 'string', required: true } })
  assert.equal(compiled.type, 'object')
  assert.deepEqual(compiled.required, ['a'])
  assert.ok(!('additionalProperties' in compiled), 'the implicit root must not declare openness')
})

test('nested objects keep their declared additionalProperties', () => {
  const compiled = compileParameterSchema({
    inner: { type: 'object', additionalProperties: true, properties: { a: { type: 'string' } } },
  })
  assert.equal(compiled.properties.inner.additionalProperties, true)
})

test('a nested object without explicit additionalProperties fails like the official compiler', () => {
  const bad = { inner: { type: 'object', properties: { a: { type: 'string' } } } }
  assert.throws(() => compileParameterSchema(bad), /additionalProperties/)
  assert.throws(() => officialTool(bad, outputSpec))
})

test('an array without items fails', () => {
  assert.throws(() => compileParameterSchema({ list: { type: 'array' } }), /items is required/)
})

test('every shipped tool compiles to a schema the Host accepts', () => {
  const tools = wpsTools()
  assert.equal(tools.length, 11)
  for (const tool of tools) {
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.parameters), `${tool.name} parameters`)
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema), `${tool.name} output`)
    assert.ok(tool.description.length > 40, `${tool.name} needs a useful description`)
  }
})

test('every shipped tool has a unique name', () => {
  const names = wpsTools().map(tool => tool.name)
  assert.equal(new Set(names).size, names.length)
})

// Malformed and partially-valid candidates, replayed against every tool so the
// two validators must agree on each verdict.
const candidates = [
  {},
  null,
  'not-an-object',
  42,
  [],
  { unknown: 1 },
  { path: 1 },
  { path: 'E:\\x.docx' },
  { path: 'E:\\x.docx', blocks: 'nope' },
  { path: 'E:\\x.docx', blocks: [] },
  { path: 'E:\\x.docx', blocks: [], mode: 'nope' },
  { path: 'E:\\x.docx', blocks: [], mode: 'append', overwrite: 'yes' },
  { path: 'E:\\x.xlsx', sheets: [] },
  { path: 'E:\\x.pptx', slides: [{ title: 'a', bullets: ['b'] }] },
  { force: true },
]

test('argument verdicts agree with the official validator for every tool', () => {
  for (const tool of wpsTools()) {
    for (const candidate of candidates) {
      const mine = validateAgainstSchema(tool.parameters, candidate, 'arguments').length === 0
      const theirs = validateJsonSchemaValue(tool.parameters, candidate, 'arguments').length === 0
      assert.equal(
        mine,
        theirs,
        `${tool.name} disagreed on ${JSON.stringify(candidate)}: plugin=${mine} official=${theirs}`,
      )
    }
  }
})

test('a valid argument set passes both validators', () => {
  const tool = wpsTools().find(candidate => candidate.name === 'wps_slides_create')
  const args = { path: 'E:\\deck.pptx', slides: [{ title: 'Q3', bullets: ['a', 'b'] }] }
  assert.deepEqual(validateAgainstSchema(tool.parameters, args, 'arguments'), [])
  assert.deepEqual(validateJsonSchemaValue(tool.parameters, args, 'arguments'), [])
})
