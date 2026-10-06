/**
 * The agent-facing WPS tool surface.
 *
 * Naming and behaviour follow the local-first convention used elsewhere in the
 * Harness: these tools drive software on this machine, they never reach out to
 * a service, and every path they take is checked before anything is written.
 */
import type { InferArgs, InferValue } from './tool-kit.js';
/** Report which WPS engines are installed and reachable. */
export declare function wpsEnvTool(): import("./tool-kit.js").ToolDefinition;
/** Create or append a Writer document. */
export declare function wpsWriterCreateTool(): import("./tool-kit.js").ToolDefinition;
/** Read text back out of a Writer document. */
export declare function wpsWriterReadTool(): import("./tool-kit.js").ToolDefinition;
/** Create a Spreadsheets workbook. */
export declare function wpsSheetCreateTool(): import("./tool-kit.js").ToolDefinition;
/** Read values out of a workbook. */
export declare function wpsSheetReadTool(): import("./tool-kit.js").ToolDefinition;
/** Create a Presentation deck. */
export declare function wpsSlidesCreateTool(): import("./tool-kit.js").ToolDefinition;
/** Read back slide text. */
export declare function wpsSlidesReadTool(): import("./tool-kit.js").ToolDefinition;
/** Convert an Office file to PDF through WPS. */
export declare function wpsConvertPdfTool(): import("./tool-kit.js").ToolDefinition;
/** Open a file in the user's visible WPS. */
export declare function wpsOpenTool(): import("./tool-kit.js").ToolDefinition;
/** Close a document the agent opened. */
export declare function wpsCloseTool(): import("./tool-kit.js").ToolDefinition;
/** Release automation instances. */
export declare function wpsQuitTool(): import("./tool-kit.js").ToolDefinition;
/** Every tool this plugin registers, in prompt order. */
export declare function wpsTools(): ReturnType<typeof wpsEnvTool>[];
/** Tool names, for the system-prompt announcement. */
export declare const WPS_TOOL_NAMES: readonly ["wps_env", "wps_writer_create", "wps_writer_read", "wps_sheet_create", "wps_sheet_read", "wps_slides_create", "wps_slides_read", "wps_convert_pdf", "wps_open", "wps_close", "wps_quit"];
/** Re-exported for tests that exercise the inferred argument types. */
export type { InferArgs, InferValue };
//# sourceMappingURL=tools.d.ts.map