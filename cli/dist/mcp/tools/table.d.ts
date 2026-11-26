import type { McpToolAnnotations, McpToolResult } from "../server.js";
import { type UpDeps } from "./families/up.js";
import { type RunFlisk } from "./run.js";
/** The injectable dependencies a row's `run` adapter may need. */
export interface FliskToolDeps {
    run: RunFlisk;
    up: UpDeps;
}
/**
 * One MCP tool, as data: the name, aliases, description and input schema are what tools/list returns, `annotations` is
 * the behavior hints, and `run` builds the handler from the injected dependencies (one shared adapter per kind of
 * command, so no row repeats the CLI plumbing).
 */
export interface FliskToolSpec {
    name: string;
    aliases?: readonly string[];
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: McpToolAnnotations;
    run: (deps: FliskToolDeps) => (args: Record<string, unknown>) => Promise<McpToolResult>;
}
/**
 * The CLI command behind each MCP tool (#4258). Kept in one table so tools/list can name the exact
 * equivalent and a test fails when a tool is added without one. Placeholders are literal in the
 * advertised description so a model can see which arguments it maps to.
 */
export declare const MCP_CLI_EQUIVALENTS: Readonly<Record<string, string>>;
/**
 * The MCP tool definitions, one row per tool. `createFliskTools` in ../tools.ts maps each row to a `McpTool` and wraps it
 * with the output-redaction pass that every tool shares. Keep the order: the tool list is presented in this order.
 */
export declare const TOOL_TABLE: readonly FliskToolSpec[];
