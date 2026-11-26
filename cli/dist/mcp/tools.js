// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { OUTPUT_WITHHELD, projectSecretValues, redactValue } from "../utils/secret-redaction.js";
import { buildConfigRegenerateArgs, configExplainArgs, configRegenerateArgs, configVerifyArgs, summarizeConfigVerify, } from "./tools/families/config.js";
import { downArgs } from "./tools/families/down.js";
import { buildLogsArgs, logsArgs } from "./tools/families/logs.js";
import { buildProjectEjectArgs, buildProjectImportArgs, buildProjectInitArgs, projectEjectArgs, projectImportArgs, projectInfoArgs, projectInitArgs, } from "./tools/families/project.js";
import { agentListArgs, agentSessionsArgs, buildResourceCreateArgs, buildToolAddArgs, resourceCreateArgs, resourceListArgs, resourceRestartArgs, resourceRunArgs, toolAddArgs, } from "./tools/families/resource.js";
import { buildStackAssignArgs, networkListArgs, stackAssignArgs, stackListArgs, } from "./tools/families/stack.js";
import { buildStatusArgs, doctorArgs, runtimeCheckArgs, statusArgs, trimStatusToUnhealthy, } from "./tools/families/status.js";
import { buildUpArgs, defaultUpDeps, readNativeUpSnapshot, startUp, upArgs, } from "./tools/families/up.js";
import { buildWaitArgs, waitArgs, waitCliTimeoutMs } from "./tools/families/wait.js";
import { runFliskCli, toTextResult, toToolResult } from "./tools/run.js";
import { projectPath } from "./tools/shared.js";
import { MCP_CLI_EQUIVALENTS, TOOL_TABLE } from "./tools/table.js";
// The tool modules keep the same public surface this file always had; the definitions themselves live in the data table.
// The spec-bound argument tables: one per tool that runs `flisk <command>`, each declared beside the
// family module whose handler runs it. They are re-exported here so the tables' consumers (tests,
// scorers) keep the same import path the tool surface always had.
export { agentListArgs, agentSessionsArgs, buildConfigRegenerateArgs, buildLogsArgs, buildProjectEjectArgs, buildProjectImportArgs, buildProjectInitArgs, buildResourceCreateArgs, buildStackAssignArgs, buildStatusArgs, buildToolAddArgs, buildUpArgs, buildWaitArgs, configExplainArgs, configRegenerateArgs, configVerifyArgs, defaultUpDeps, doctorArgs, downArgs, logsArgs, MCP_CLI_EQUIVALENTS, networkListArgs, projectEjectArgs, projectImportArgs, projectInfoArgs, projectInitArgs, readNativeUpSnapshot, resourceCreateArgs, resourceListArgs, resourceRestartArgs, resourceRunArgs, runFliskCli, runtimeCheckArgs, stackAssignArgs, stackListArgs, startUp, statusArgs, summarizeConfigVerify, TOOL_TABLE, toolAddArgs, toTextResult, toToolResult, trimStatusToUnhealthy, upArgs, waitArgs, waitCliTimeoutMs, };
/** Every tool that runs `flisk <command>`, keyed by tool name, and the table that drives its argv and schema. */
export const TOOL_ARG_SPECS = {
    doctor: doctorArgs,
    up: upArgs,
    down: downArgs,
    status: statusArgs,
    wait: waitArgs,
    logs: logsArgs,
    resource_list: resourceListArgs,
    resource_restart: resourceRestartArgs,
    resource_run: resourceRunArgs,
    agent_list: agentListArgs,
    agent_sessions: agentSessionsArgs,
    stack_list: stackListArgs,
    project_info: projectInfoArgs,
    network_list: networkListArgs,
    config_verify: configVerifyArgs,
    config_explain: configExplainArgs,
    runtime_check: runtimeCheckArgs,
    config_regenerate: configRegenerateArgs,
    resource_create: resourceCreateArgs,
    tool_add: toolAddArgs,
    stack_assign: stackAssignArgs,
    project_init: projectInitArgs,
    project_eject: projectEjectArgs,
    project_import: projectImportArgs,
};
/**
 * The MCP tool set: one `McpTool` per row of the data table (tools/table.ts). The row's `run` adapter builds the handler
 * from the injected dependencies; the definition itself is data. Every tool returns what a `flisk` child printed, and a
 * child can quote an application's output (logs, `run`, agent sessions, failure excerpts). The child masks it already;
 * this is the last stop before the text reaches an MCP client.
 */
export function createFliskTools(run = runFliskCli, up = defaultUpDeps) {
    const deps = { run, up };
    return TOOL_TABLE.map((spec) => {
        const toolHandler = spec.run(deps);
        return {
            name: spec.name,
            ...(spec.aliases ? { aliases: spec.aliases } : {}),
            description: `${spec.description} CLI equivalent: \`${MCP_CLI_EQUIVALENTS[spec.name] ?? "unknown"}\`.`,
            inputSchema: spec.inputSchema,
            annotations: spec.annotations,
            handler: async (args) => {
                const result = await toolHandler(args);
                const secrets = projectSecretValues(projectPath(args.projectPath));
                return {
                    ...result,
                    data: secrets === null
                        ? { errors: [{ code: "ENV_UNREADABLE", message: OUTPUT_WITHHELD }] }
                        : redactValue(result.data, secrets),
                    ...(result.text === undefined
                        ? {}
                        : { text: secrets === null ? OUTPUT_WITHHELD : redactValue(result.text, secrets) }),
                    ...(secrets === null ? { isError: true } : {}),
                };
            },
        };
    });
}
