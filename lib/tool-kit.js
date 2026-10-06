/**
 * A dependency-free stand-in for the official `defineTool`.
 *
 * The Host only requires a `ToolDefinition` to be a plain object carrying a
 * compiled parameter schema, an output schema plus renderer, and an execute
 * function. This module produces exactly that, so the plugin can be installed
 * as a linked package without resolving any `@deepseek-ai/*` module at runtime.
 */
import { ToolArgumentError, compileParameterSchema, compileValueSchema, validateAgainstSchema, } from './json-schema.js';
/**
 * Define a tool with inferred arguments and strict pre-execution validation.
 * @param options - the typed definition.
 * @returns a registry-ready definition for `ctx.tools.register`.
 */
export function defineTool(options) {
    const parameters = compileParameterSchema(options.parameters);
    const outputSchema = compileValueSchema(options.output.schema, 'output.schema');
    const definition = {
        name: options.name,
        description: options.description,
        parameters,
        output: {
            schema: outputSchema,
            render: (args, value) => options.output.render(args, value),
        },
        async execute(args, exec) {
            const violations = validateAgainstSchema(parameters, args);
            if (violations.length > 0)
                throw new ToolArgumentError(violations);
            return await options.execute(args, exec);
        },
    };
    const classify = options.isConcurrencySafe;
    if (classify !== undefined) {
        definition.isConcurrencySafe = (args) => {
            // Fail closed: an unparseable call is never treated as parallel-safe.
            if (validateAgainstSchema(parameters, args).length > 0)
                return false;
            return classify(args);
        };
    }
    return definition;
}
//# sourceMappingURL=tool-kit.js.map