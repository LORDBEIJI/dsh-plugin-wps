/**
 * Author-facing schema specs and their compilation to the JSON Schema subset
 * the DSH Host enforces, plus a validator for model-generated arguments.
 *
 * The plugin deliberately carries no runtime dependency on the official SDK, so
 * this module reimplements the two behaviours the plugin actually needs:
 * compiling a declarative parameter/value spec into raw schema, and rejecting
 * malformed arguments before a tool body runs. `tests/schema-parity.test.mjs`
 * pins the compiler against the official `defineTool` output, so the
 * reimplementation is verified rather than assumed.
 *
 * Compilation rules (matching the Host exactly):
 *   - The parameter root is an implicit open object: no `additionalProperties`.
 *   - Every nested object spec must declare `additionalProperties` explicitly.
 *   - A property's `required: true` is lifted into the parent's `required` list
 *     and never appears inside the property schema itself.
 *   - `type: 'json'` compiles to an empty, annotation-only schema.
 */
/** A spec that cannot compile into the enforced subset. */
export class SchemaSpecError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchemaSpecError';
    }
}
/**
 * Compile a tool's parameter map into the implicit-open-object root schema.
 * @param spec - per-property parameter specs.
 * @returns the raw object-rooted schema, with no implicit-root openness field.
 */
export function compileParameterSchema(spec) {
    const properties = {};
    const required = [];
    for (const [name, property] of Object.entries(spec)) {
        properties[name] = compileSpec(property, `parameters.${name}`);
        if (property.required === true)
            required.push(name);
    }
    const node = { type: 'object', properties };
    if (required.length > 0)
        node.required = required;
    return node;
}
/**
 * Compile a value spec (a tool's canonical output shape or a nested node).
 * @param spec - the spec to compile.
 * @param path - diagnostic path for error messages.
 * @returns the raw schema node.
 */
export function compileValueSchema(spec, path = 'output.schema') {
    return compileSpec(spec, path);
}
function compileSpec(spec, path) {
    const node = {};
    if (spec.description !== undefined)
        node.description = spec.description;
    if (spec.oneOf !== undefined) {
        if (spec.oneOf.length === 0)
            throw new SchemaSpecError(`${path}.oneOf must not be empty`);
        node.oneOf = spec.oneOf.map((branch, index) => compileSpec(branch, `${path}.oneOf[${index}]`));
        return node;
    }
    // `json` is author-only: it compiles to an annotation-only schema that
    // accepts any value.
    const specType = spec.type;
    if (specType === undefined) {
        throw new SchemaSpecError(`${path}.type is required unless the spec uses oneOf`);
    }
    if (specType === 'json')
        return node;
    node.type = specType;
    if (specType === 'array') {
        if (spec.items === undefined)
            throw new SchemaSpecError(`${path}.items is required for an array`);
        node.items = compileSpec(spec.items, `${path}.items`);
    }
    if (specType === 'object') {
        if (typeof spec.additionalProperties !== 'boolean') {
            throw new SchemaSpecError(`${path}.additionalProperties must be explicitly true or false`);
        }
        node.additionalProperties = spec.additionalProperties;
        const properties = {};
        const required = [];
        for (const [name, property] of Object.entries(spec.properties ?? {})) {
            properties[name] = compileSpec(property, `${path}.properties.${name}`);
            if (property.required === true)
                required.push(name);
        }
        node.properties = properties;
        if (required.length > 0)
            node.required = required;
    }
    if (spec.enum !== undefined)
        node.enum = [...spec.enum];
    return node;
}
/** Invalid model-generated arguments for a typed tool. */
export class ToolArgumentError extends Error {
    /** Individual violations in schema-walk order. */
    violations;
    constructor(violations) {
        super(`invalid tool arguments:\n${violations.map(violation => `- ${violation}`).join('\n')}`);
        this.name = 'ToolArgumentError';
        this.violations = violations;
    }
}
/**
 * Validate a value against a compiled schema.
 * @param schema - the compiled schema to enforce.
 * @param value - the candidate value.
 * @param path - diagnostic path for the value's position.
 * @returns path-qualified violations; empty means valid.
 */
export function validateAgainstSchema(schema, value, path = 'arguments') {
    const violations = [];
    validateNode(schema, value, path, violations);
    return violations;
}
function validateNode(schema, value, path, violations) {
    if (schema.oneOf !== undefined) {
        const matches = schema.oneOf.filter(branch => validateAgainstSchema(branch, value, path).length === 0);
        if (matches.length === 0)
            violations.push(`${path} must match one of the allowed shapes`);
        return;
    }
    if (schema.enum !== undefined && !schema.enum.some(candidate => candidate === value)) {
        violations.push(`${path} must be one of ${schema.enum.map(candidate => JSON.stringify(candidate)).join(', ')}`);
        return;
    }
    switch (schema.type) {
        case undefined:
            return;
        case 'null':
            if (value !== null)
                violations.push(`${path} must be null`);
            return;
        case 'boolean':
            if (typeof value !== 'boolean')
                violations.push(`${path} must be a boolean`);
            return;
        case 'string':
            if (typeof value !== 'string')
                violations.push(`${path} must be a string`);
            return;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value))
                violations.push(`${path} must be a finite number`);
            return;
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value))
                violations.push(`${path} must be an integer`);
            return;
        case 'array':
            validateArray(schema, value, path, violations);
            return;
        case 'object':
            validateObject(schema, value, path, violations);
            return;
    }
}
function validateArray(schema, value, path, violations) {
    if (!Array.isArray(value)) {
        violations.push(`${path} must be an array`);
        return;
    }
    const items = schema.items;
    if (items === undefined)
        return;
    for (let index = 0; index < value.length; index++) {
        validateNode(items, value[index], `${path}[${index}]`, violations);
    }
}
function validateObject(schema, value, path, violations) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        violations.push(`${path} must be an object`);
        return;
    }
    const record = value;
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
        if (!(name in record) || record[name] === undefined)
            violations.push(`${path}.${name} is required`);
    }
    if (schema.additionalProperties === false) {
        for (const name of Object.keys(record)) {
            if (!(name in properties))
                violations.push(`${path}.${name} is not an allowed property`);
        }
    }
    for (const [name, child] of Object.entries(properties)) {
        const childValue = record[name];
        if (childValue !== undefined)
            validateNode(child, childValue, `${path}.${name}`, violations);
    }
}
//# sourceMappingURL=json-schema.js.map