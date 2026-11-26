import type { McpToolResult } from "../server.js";
export type RunFlisk = (args: string[], options?: {
    timeoutMs?: number;
    cwd?: string;
}) => Promise<FliskRun>;
export interface FliskRun {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}
/** Runs this same CLI (`flisk <args>`) so every tool behaves exactly like its command. */
export declare const runFliskCli: RunFlisk;
/**
 * Turn a command's `--json` stdout into a tool result. A parseable envelope with errors, or `ok: false` (in `data`, or at
 * the top level for `runtime --check-assets --json`, which prints no envelope), is an error result.
 */
export declare function toToolResult(run: FliskRun): McpToolResult;
/**
 * Turn the output of a command that has no `--json` (the scaffolding commands) into a tool result: its text output, and an
 * error result when it exits non-zero. Failures are printed to stderr, so it is returned too.
 */
export declare function toTextResult(run: FliskRun): McpToolResult;
/**
 * The generic handler for a table row whose tool maps to one `flisk` command with a `--json` envelope: build the
 * arguments, run the CLI through the injected runner and convert its output. Per family, not per tool.
 */
export declare const viaCli: (build: (args: Record<string, unknown>) => string[], options?: {
    timeoutMs?: number;
}) => ({ run }: {
    run: RunFlisk;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
/** For a command without `--json`: returns its text output. */
export declare const viaCliText: (build: (args: Record<string, unknown>) => string[], options?: {
    timeoutMs?: number;
}) => ({ run }: {
    run: RunFlisk;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
