/**
 * A dependency-free stand-in for the official `defineTool`.
 *
 * The Host only requires a `ToolDefinition` to be a plain object carrying a
 * compiled parameter schema, an output schema plus renderer, and an execute
 * function. This module produces exactly that, so the plugin can be installed
 * as a linked package without resolving any `@deepseek-ai/*` module at runtime.
 */

import type { JsonSchemaNode, JsonValue, ParameterSchemaSpec, SchemaSpec } from './json-schema.js'
import {
  ToolArgumentError,
  compileParameterSchema,
  compileValueSchema,
  validateAgainstSchema,
} from './json-schema.js'

/**
 * One model-facing content block.
 *
 * Deliberately identical in shape to the official `TextBlock`, so a definition
 * built here is structurally assignable to the Host's `ToolDefinition`.
 */
export interface ContentBlock {
  readonly type: 'text'
  readonly text: string
}

/** The execution identity a tool body may consult. */
export interface ToolRunContext {
  /** Caller cancellation; a long COM call forwards it to the worker process. */
  readonly signal: AbortSignal
}

/** A registry-ready tool definition, structurally compatible with the Host's. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchemaNode
  readonly output: {
    readonly schema: JsonSchemaNode
    render(args: unknown, value: JsonValue): ContentBlock[]
  }
  isConcurrencySafe?(args: unknown): boolean
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

/** Infer the TypeScript type a single spec describes. */
type InferSpec<S> = S extends { oneOf: readonly (infer Branch)[] }
  ? InferSpec<Branch>
  : S extends { enum: readonly (infer Member)[] }
    ? Member
    : S extends { type: 'string' }
      ? string
      : S extends { type: 'integer' }
        ? number
        : S extends { type: 'number' }
          ? number
          : S extends { type: 'boolean' }
            ? boolean
            : S extends { type: 'null' }
              ? null
              : S extends { type: 'json' }
                ? JsonValue
                : S extends { type: 'array'; items: infer Item }
                  ? InferSpec<Item>[]
                  : S extends { type: 'object'; properties: infer Props }
                    ? InferObject<Props>
                    : JsonValue

/** Infer an object type from a property map, honouring per-property `required`. */
type InferObject<Props> = {
  [K in keyof Props as Props[K] extends { required: true } ? K : never]: InferSpec<Props[K]>
} & {
  [K in keyof Props as Props[K] extends { required: true } ? never : K]?: InferSpec<Props[K]>
}

/** The argument type a parameter spec describes. */
export type InferArgs<S extends ParameterSchemaSpec> = InferObject<S>

/** The canonical value type an output spec describes. */
export type InferValue<O extends SchemaSpec> = InferSpec<O>

/** Options accepted by {@link defineTool}. */
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends SchemaSpec> {
  readonly name: string
  readonly description: string
  readonly parameters: S
  readonly output: {
    readonly schema: O
    render(args: InferArgs<S>, value: InferValue<O>): ContentBlock[]
  }
  /**
   * Whether this call may run beside sibling calls. Omitted means exclusive,
   * which is the right default for COM automation.
   */
  readonly isConcurrencySafe?: (args: InferArgs<S>) => boolean
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<O>>
}

/**
 * Define a tool with inferred arguments and strict pre-execution validation.
 * @param options - the typed definition.
 * @returns a registry-ready definition for `ctx.tools.register`.
 */
export function defineTool<const S extends ParameterSchemaSpec, const O extends SchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition {
  const parameters = compileParameterSchema(options.parameters)
  const outputSchema = compileValueSchema(options.output.schema, 'output.schema')

  const definition: ToolDefinition = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (args, value) => options.output.render(args as InferArgs<S>, value as unknown as InferValue<O>),
    },
    async execute(args, exec) {
      const violations = validateAgainstSchema(parameters, args)
      if (violations.length > 0) throw new ToolArgumentError(violations)
      return await options.execute(args as InferArgs<S>, exec)
    },
  }

  const classify = options.isConcurrencySafe
  if (classify !== undefined) {
    definition.isConcurrencySafe = (args) => {
      // Fail closed: an unparseable call is never treated as parallel-safe.
      if (validateAgainstSchema(parameters, args).length > 0) return false
      return classify(args as InferArgs<S>)
    }
  }

  return definition
}
