import type { McpTool } from "./server.js";
import type { ArgSpec } from "./spec-args.js";
import { buildConfigRegenerateArgs, configExplainArgs, configRegenerateArgs, configVerifyArgs, summarizeConfigVerify } from "./tools/families/config.js";
import { downArgs } from "./tools/families/down.js";
import { buildLogsArgs, logsArgs } from "./tools/families/logs.js";
import { buildProjectEjectArgs, buildProjectImportArgs, buildProjectInitArgs, projectEjectArgs, projectImportArgs, projectInfoArgs, projectInitArgs } from "./tools/families/project.js";
import { agentListArgs, agentSessionsArgs, buildResourceCreateArgs, buildToolAddArgs, resourceCreateArgs, resourceListArgs, resourceRestartArgs, resourceRunArgs, toolAddArgs } from "./tools/families/resource.js";
import { buildStackAssignArgs, networkListArgs, stackAssignArgs, stackListArgs } from "./tools/families/stack.js";
import { buildStatusArgs, doctorArgs, runtimeCheckArgs, statusArgs, trimStatusToUnhealthy } from "./tools/families/status.js";
import { buildUpArgs, defaultUpDeps, readNativeUpSnapshot, startUp, type UpDeps, upArgs } from "./tools/families/up.js";
import { buildWaitArgs, waitArgs, waitCliTimeoutMs } from "./tools/families/wait.js";
import { type RunFlisk, runFliskCli, toTextResult, toToolResult } from "./tools/run.js";
import { MCP_CLI_EQUIVALENTS, TOOL_TABLE } from "./tools/table.js";
export type { ArgSpec } from "./spec-args.js";
export type { NativeUpSnapshot, UpDeps, UpState } from "./tools/families/up.js";
export type { FliskRun, RunFlisk } from "./tools/run.js";
export type { FliskToolDeps, FliskToolSpec } from "./tools/table.js";
export { agentListArgs, agentSessionsArgs, buildConfigRegenerateArgs, buildLogsArgs, buildProjectEjectArgs, buildProjectImportArgs, buildProjectInitArgs, buildResourceCreateArgs, buildStackAssignArgs, buildStatusArgs, buildToolAddArgs, buildUpArgs, buildWaitArgs, configExplainArgs, configRegenerateArgs, configVerifyArgs, defaultUpDeps, doctorArgs, downArgs, logsArgs, MCP_CLI_EQUIVALENTS, networkListArgs, projectEjectArgs, projectImportArgs, projectInfoArgs, projectInitArgs, readNativeUpSnapshot, resourceCreateArgs, resourceListArgs, resourceRestartArgs, resourceRunArgs, runFliskCli, runtimeCheckArgs, stackAssignArgs, stackListArgs, startUp, statusArgs, summarizeConfigVerify, TOOL_TABLE, toolAddArgs, toTextResult, toToolResult, trimStatusToUnhealthy, upArgs, waitArgs, waitCliTimeoutMs, };
/** Every tool that runs `flisk <command>`, keyed by tool name, and the table that drives its argv and schema. */
export declare const TOOL_ARG_SPECS: Readonly<Record<string, ArgSpec>>;
/**
 * The MCP tool set: one `McpTool` per row of the data table (tools/table.ts). The row's `run` adapter builds the handler
 * from the injected dependencies; the definition itself is data. Every tool returns what a `flisk` child printed, and a
 * child can quote an application's output (logs, `run`, agent sessions, failure excerpts). The child masks it already;
 * this is the last stop before the text reaches an MCP client.
 */
export declare function createFliskTools(run?: RunFlisk, up?: UpDeps): McpTool[];
