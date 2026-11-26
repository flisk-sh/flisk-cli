import type { McpToolResult } from "../../server.js";
import { type RunFlisk } from "../run.js";
/**
 * The read-only health checks: the running stack's live state (`status`), the host's ability to run the stack
 * (`doctor`) and the installed CLI's bundled runtime assets (`runtime_check`). Each tool's arguments are
 * declared once in an argSpec table bound to the command's generated spec.
 */
/** The `doctor` tool's arguments, bound to the `flisk doctor` spec. */
export declare const doctorArgs: import("../../spec-args.js").ArgSpec;
/** `flisk doctor --json`, with `--problems-only` for concise diagnostics and `--no-ping` to skip the health endpoints. */
export declare function buildDoctorArgs(args: Record<string, unknown>): string[];
/** The `status` tool's arguments, bound to the `flisk status` spec. */
export declare const statusArgs: import("../../spec-args.js").ArgSpec;
/** `flisk status --json`, narrowed by `unhealthy` and `stack` the way the CLI does. */
export declare function buildStatusArgs(args: Record<string, unknown>): string[];
/** The `runtime_check` tool's arguments, bound to the `flisk runtime` spec. */
export declare const runtimeCheckArgs: import("../../spec-args.js").ArgSpec;
/** `flisk runtime --check-assets --json`. */
export declare function buildRuntimeCheckArgs(): string[];
/**
 * `flisk status --json --unhealthy` still lists every service (the flag only shortens the text output, and the envelope
 * carries the names in `data.unhealthy`). For an agent that wants the broken services only, drop the others from
 * `data.resources` and from each stack's `resources`, and say so in `data.filteredTo`. Counts keep describing the whole project.
 */
export declare function trimStatusToUnhealthy(result: McpToolResult): McpToolResult;
/** The `status` row's handler: the plain `flisk status` run, trimmed to the broken services when `unhealthy` is set. */
export declare const statusRun: (deps: {
    run: RunFlisk;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
