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
/** Any JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** The scalar and container types the enforced schema subset allows. */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
/** A compiled, enforced JSON Schema node. */
export interface JsonSchemaNode {
    type?: JsonSchemaType;
    oneOf?: JsonSchemaNode[];
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchemaNode;
    enum?: (string | number | boolean | null)[];
    description?: string;
    /** Open for structural assignability to the Host's `Record<string, unknown>`. */
    readonly [key: string]: unknown;
}
/** A spec type: the schema types plus the author-only `json` escape hatch. */
export type SpecType = JsonSchemaType | 'json';
/**
 * One declarative schema spec. `required` is author-only metadata consumed by
 * the enclosing object, which is why it does not survive compilation.
 */
export interface SchemaSpec {
    readonly type?: SpecType;
    readonly required?: boolean;
    readonly description?: string;
    readonly enum?: readonly (string | number | boolean | null)[];
    readonly oneOf?: readonly SchemaSpec[];
    readonly items?: SchemaSpec;
    readonly properties?: Record<string, SchemaSpec>;
    readonly additionalProperties?: boolean;
}
/** The per-property parameter map that defines a tool's argument object. */
export type ParameterSchemaSpec = Record<string, SchemaSpec>;
/** A spec that cannot compile into the enforced subset. */
export declare class SchemaSpecError extends Error {
    constructor(message: string);
}
/**
 * Compile a tool's parameter map into the implicit-open-object root schema.
 * @param spec - per-property parameter specs.
 * @returns the raw object-rooted schema, with no implicit-root openness field.
 */
export declare function compileParameterSchema(spec: ParameterSchemaSpec): JsonSchemaNode;
/**
 * Compile a value spec (a tool's canonical output shape or a nested node).
 * @param spec - the spec to compile.
 * @param path - diagnostic path for error messages.
 * @returns the raw schema node.
 */
export declare function compileValueSchema(spec: SchemaSpec, path?: string): JsonSchemaNode;
/** Invalid model-generated arguments for a typed tool. */
export declare class ToolArgumentError extends Error {
    /** Individual violations in schema-walk order. */
    readonly violations: string[];
    constructor(violations: string[]);
}
/**
 * Validate a value against a compiled schema.
 * @param schema - the compiled schema to enforce.
 * @param value - the candidate value.
 * @param path - diagnostic path for the value's position.
 * @returns path-qualified violations; empty means valid.
 */
export declare function validateAgainstSchema(schema: JsonSchemaNode, value: unknown, path?: string): string[];
//# sourceMappingURL=json-schema.d.ts.map