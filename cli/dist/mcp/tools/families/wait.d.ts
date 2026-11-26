import type { McpToolResult } from "../../server.js";
import { type RunFlisk } from "../run.js";
/** The `wait` tool's arguments, bound to the `flisk wait` spec. */
export declare const waitArgs: import("../../spec-args.js").ArgSpec;
/** `flisk wait [services...] --timeout=<seconds> --json` for the `wait` tool. */
export declare function buildWaitArgs(args: Record<string, unknown>): string[];
/** A tool call may wait longer than the usual CLI timeout: give the command its full window plus a little slack. */
export declare function waitCliTimeoutMs(args: Record<string, unknown>): number;
/** The `wait` row's handler: `flisk wait --json` with a timeout sized to the requested wait window. */
export declare const waitRun: (deps: {
    run: RunFlisk;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
