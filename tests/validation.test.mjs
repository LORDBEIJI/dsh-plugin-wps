// The argument validator that guards every tool body before it can touch WPS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileParameterSchema, validateAgainstSchema } from '../lib/json-schema.js'

function validate(spec, value) {
  return validateAgainstSchema(compileParameterSchema(spec), value, 'arguments')
}

test('a missing required property is reported', () => {
  const violations = validate({ path: { type: 'string', required: true } }, {})
  assert.equal(violations.length, 1)
  assert.match(violations[0], /arguments\.path is required/)
})

test('an explicit undefined does not satisfy a required property', () => {
  assert.equal(validate({ path: { type: 'string', required: true } }, { path: undefined }).length, 1)
})

test('an optional property may be absent', () => {
  assert.deepEqual(validate({ path: { type: 'string', required: true }, n: { type: 'integer' } }, { path: 'a' }), [])
})

test('a wrong scalar type is reported', () => {
  assert.match(validate({ n: { type: 'integer', required: true } }, { n: 'x' })[0], /must be an integer/)
  assert.match(validate({ n: { type: 'integer', required: true } }, { n: 1.5 })[0], /must be an integer/)
  assert.deepEqual(validate({ n: { type: 'integer', required: true } }, { n: 1.0 }), [])
  assert.match(validate({ s: { type: 'string', required: true } }, { s: 1 })[0], /must be a string/)
  assert.match(validate({ b: { type: 'boolean', required: true } }, { b: 'true' })[0], /must be a boolean/)
})

test('an enum rejects an unknown member', () => {
  const spec = { mode: { type: 'string', enum: ['create', 'append'], required: true } }
  assert.deepEqual(validate(spec, { mode: 'append' }), [])
  assert.match(validate(spec, { mode: 'replace' })[0], /must be one of/)
})

test('oneOf accepts either branch and rejects neither', () => {
  const spec = { out: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true } }
  assert.deepEqual(validate(spec, { out: 'E:\\a.pdf' }), [])
  assert.deepEqual(validate(spec, { out: null }), [])
  assert.equal(validate(spec, { out: 7 }).length, 1)
})

test('an array validates every element', () => {
  const spec = { tags: { type: 'array', items: { type: 'string' }, required: true } }
  assert.deepEqual(validate(spec, { tags: ['a', 'b'] }), [])
  const violations = validate(spec, { tags: ['a', 2] })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /arguments\.tags\[1\]/)
  assert.match(validate(spec, { tags: 'a' })[0], /must be an array/)
})

test('a nested object validates its own required set', () => {
  const spec = {
    block: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { type: { type: 'string', required: true }, level: { type: 'integer' } },
    },
  }
  assert.deepEqual(validate(spec, { block: { type: 'heading' } }), [])
  assert.match(validate(spec, { block: {} })[0], /arguments\.block\.type is required/)
})

test('additionalProperties false rejects an unknown key', () => {
  const spec = {
    block: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: { type: { type: 'string', required: true } },
    },
  }
  const violations = validate(spec, { block: { type: 'heading', nope: 1 } })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /arguments\.block\.nope is not an allowed property/)
})

test('a non-object argument root is rejected', () => {
  assert.equal(validate({ a: { type: 'string' } }, 'nope').length, 1)
  assert.equal(validate({ a: { type: 'string' } }, []).length, 1)
  assert.equal(validate({ a: { type: 'string' } }, null).length, 1)
})

test('a json spec accepts any value', () => {
  const spec = { anything: { type: 'json', required: true } }
  assert.deepEqual(validate(spec, { anything: { nested: [1, 'two', null] } }), [])
  assert.deepEqual(validate(spec, { anything: 3 }), [])
})

test('paths in violations line up with the offending position', () => {
  const spec = {
    rows: {
      type: 'array',
      required: true,
      items: { type: 'array', items: { type: 'string' } },
    },
  }
  const violations = validate(spec, { rows: [['ok'], ['fine', 9]] })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /arguments\.rows\[1\]\[1\]/)
})
