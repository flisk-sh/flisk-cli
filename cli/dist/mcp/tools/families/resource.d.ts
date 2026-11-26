import type { McpToolResult } from "../../server.js";
import { type RunFlisk } from "../run.js";
/**
 * The resource family: listing and inspecting resources (`resource_list`, `agent_list`, `agent_sessions`), acting on a
 * running one (`resource_restart`, `resource_run`) and scaffolding a new one (`resource_create`, `tool_add`, which runs
 * the matching `flisk resource` command). Each tool's arguments are declared once in an argSpec table bound to the
 * command's generated spec.
 */
/** The `resource_list` tool's arguments, bound to the `flisk resources` spec. */
export declare const resourceListArgs: import("../../spec-args.js").ArgSpec;
/** `flisk resources [--stack=<stack>] --json`. */
export declare function buildResourceListArgs(args: Record<string, unknown>): string[];
/** The `agent_list` tool's arguments, bound to the `flisk resources` spec. */
export declare const agentListArgs: import("../../spec-args.js").ArgSpec;
/** `flisk resources --type=agent [--stack=<stack>] --json` for agent_list. */
export declare function buildAgentListArgs(args: Record<string, unknown>): string[];
/** The `agent_sessions` tool's arguments, bound to the `flisk agent sessions` spec. */
export declare const agentSessionsArgs: import("../../spec-args.js").ArgSpec;
/** `flisk agent sessions <resource> [--session-id=<id>] --json`. */
export declare function buildAgentSessionsArgs(args: Record<string, unknown>): string[];
/** The `resource_restart` tool's arguments, bound to the `flisk restart` spec. */
export declare const resourceRestartArgs: import("../../spec-args.js").ArgSpec;
/** `flisk restart <resource> --json`; the waitSeconds bound is clamped where the handler runs it. */
export declare function buildResourceRestartArgs(args: Record<string, unknown>): string[];
/** The `resource_restart` row's handler: a `flisk restart` whose CLI timeout follows the resource's stop grace period. */
export declare const resourceRestartRun: ({ run }: {
    run: RunFlisk;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
/** The `resource_run` tool's arguments, bound to the `flisk run` spec. */
export declare const resourceRunArgs: import("../../spec-args.js").ArgSpec;
/** `flisk run <resource> -- <command...>` for resource_run; refused without `confirm: true` since it runs any command. */
export declare function buildResourceRunArgs(args: Record<string, unknown>): string[];
/** The `tool_add` tool's arguments, bound to the `flisk tool add` spec. */
export declare const toolAddArgs: import("../../spec-args.js").ArgSpec;
/** `flisk tool add <tool> [name] --json` for the tool_add tool; the tool must be one the catalog knows. */
export declare function buildToolAddArgs(args: Record<string, unknown>): string[];
/** The `resource_create` tool's arguments, bound to the `flisk resource` spec. */
export declare const resourceCreateArgs: import("../../spec-args.js").ArgSpec;
/** `flisk resource <name> ... --json`: options as `--flag=value`, after the name, so a variadic `--feature` never takes it. */
export declare function buildResourceCreateArgs(args: Record<string, unknown>): string[];
