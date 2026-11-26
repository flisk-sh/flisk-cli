// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { McpToolAnnotations, McpToolResult } from "../server.js";
import {
  buildConfigExplainArgs,
  buildConfigRegenerateArgs,
  buildConfigVerifyArgs,
  configExplainArgs,
  configRegenerateArgs,
  configVerifyArgs,
  summarizeConfigVerify,
} from "./families/config.js";
import { buildDownArgs, downArgs } from "./families/down.js";
import { buildLogsArgs, logsArgs } from "./families/logs.js";
import {
  buildProjectEjectArgs,
  buildProjectImportArgs,
  buildProjectInfoArgs,
  buildProjectInitArgs,
  IMPORT_TIMEOUT_MS,
  PROJECT_INIT_TIMEOUT_MS,
  projectEjectArgs,
  projectImportArgs,
  projectInfoArgs,
  projectInitArgs,
  projectTemplatesRun,
} from "./families/project.js";
import {
  agentListArgs,
  agentSessionsArgs,
  buildAgentListArgs,
  buildAgentSessionsArgs,
  buildResourceCreateArgs,
  buildResourceListArgs,
  buildResourceRunArgs,
  buildToolAddArgs,
  resourceCreateArgs,
  resourceListArgs,
  resourceRestartArgs,
  resourceRestartRun,
  resourceRunArgs,
  toolAddArgs,
} from "./families/resource.js";
import {
  buildNetworkListArgs,
  buildStackAssignArgs,
  buildStackListArgs,
  networkListArgs,
  stackAssignArgs,
  stackListArgs,
} from "./families/stack.js";
import {
  buildDoctorArgs,
  buildRuntimeCheckArgs,
  doctorArgs,
  runtimeCheckArgs,
  statusArgs,
  statusRun,
} from "./families/status.js";
import { type UpDeps, upArgs, upRun } from "./families/up.js";
import { waitArgs, waitRun } from "./families/wait.js";
import { type RunFlisk, viaCli, viaCliText } from "./run.js";
import { OBJECT } from "./shared.js";

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

/** Local-only reads: they inspect the project or the running stack and change nothing. */
const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};
const WRITES_LOCALLY: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * The CLI command behind each MCP tool (#4258). Kept in one table so tools/list can name the exact
 * equivalent and a test fails when a tool is added without one. Placeholders are literal in the
 * advertised description so a model can see which arguments it maps to.
 */
export const MCP_CLI_EQUIVALENTS: Readonly<Record<string, string>> = {
  agent_list: "flisk resources --type=agent --json",
  agent_sessions: "flisk agent sessions <resource> --json",
  config_explain: "flisk config explain <file> --json",
  config_regenerate: "flisk config regenerate --dry-run --json",
  config_verify: "flisk config verify --json",
  doctor: "flisk doctor --json",
  down: "flisk down --json",
  logs: "flisk logs --json",
  network_list: "flisk networks --json",
  project_eject: "flisk eject --json",
  project_import: "flisk import --json",
  project_info: "flisk projects --json",
  project_init: "flisk project --yes",
  project_templates: "flisk project --list --json",
  resource_create: "flisk resource <name> --json",
  resource_list: "flisk resources --json",
  resource_restart: "flisk restart <resource> --json",
  resource_run: "flisk run <resource> --json -- <command>",
  runtime_check: "flisk runtime --check-assets --json",
  stack_assign: "flisk stack <stack> --resources=<resource> --json",
  stack_list: "flisk stacks --json",
  status: "flisk status --json",
  tool_add: "flisk tool add <tool> --json",
  up: "flisk up",
  wait: "flisk wait --json",
};

/**
 * The MCP tool definitions, one row per tool. `createFliskTools` in ../tools.ts maps each row to a `McpTool` and wraps it
 * with the output-redaction pass that every tool shares. Keep the order: the tool list is presented in this order.
 */
export const TOOL_TABLE: readonly FliskToolSpec[] = [
  {
    name: "doctor",
    description:
      "Check whether this machine can run the Flisk stack (Docker, Tilt, ports). Read-only. Pass problemsOnly: true for concise diagnostics (drops passing checks, adds summary counts); recommended for agents. Optionally set projectPath to include checks for a specific Flisk project; for local-process services that also reports missing node_modules/.venv with the exact install command, and hints at a .env in another git worktree with the copy command (it never copies). Returns data.ready and data.host.canUp; run it before `up`. For the state of a running stack use `status`; for whether generated files are consistent use `config_verify`.",
    inputSchema: doctorArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildDoctorArgs),
  },
  {
    name: "up",
    description:
      "Start the stack (or part of it) detached from the optional projectPath. The result carries `state`: `ready` (every local-process service passed its readiness check), `starting` (launched, readiness not confirmed: the default after a short wait; poll `status`, or pass waitForReady), `failed` (a service exited or gave up; the error carries its own output) or `timeout` (waitForReady was set and readiness was not reached in waitSeconds; it keeps starting). Each `data.failures` entry carries `exitCode`, a machine-readable `code` (PROGRAM_NOT_FOUND, PORT_IN_USE, HEALTHCHECK_FAILED, CRASH_LOOP, DEPENDENCY_FAILED or UNKNOWN) and `suggestions`, the same fields `flisk up --json` reports. `started: true` never means ready. Fails fast on an unknown service, an unsupported host, or a Tilt already running.",
    inputSchema: upArgs.inputSchema({ projectPath: true }),
    annotations: WRITES_LOCALLY,
    run: upRun,
  },
  {
    name: "down",
    description:
      "Stop the running stack, optionally selecting its project with projectPath. It stops the running services and does not edit the project's files. Use `status` first to see whether a stack is running, set dryRun to preview, and start it again with `up`.",
    inputSchema: downArgs.inputSchema({ projectPath: true }),
    annotations: { ...WRITES_LOCALLY, destructiveHint: true, idempotentHint: true },
    run: viaCli(buildDownArgs),
  },
  {
    name: "status",
    description:
      "Show the live state of the stack: its stacks, resources, their ingress URLs and container ports, the stack-level ports, and Tilt readiness (data.tilt.readiness: ready, pending, failures, enabled; null when no Tilt answers). A project of local-process (`command`) services reports no tilt block: readiness is data.readiness and each service's url is its localhost address. Read-only. Poll it after `up`; after a failed `up` call it first with unhealthy: true to see only the broken services (data.resources and each stack's resources then hold only those; data.unhealthy names them and data.filteredTo says it was trimmed). For the services a project defines whether or not they run use `resource_list`; for URLs only use `network_list`; for host checks use `doctor`. Optionally select the project with projectPath.",
    inputSchema: statusArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: statusRun,
  },
  {
    name: "wait",
    description:
      "Block until the named services (or every service when services is omitted) are healthy, using the same readiness rule as `up --wait` and `status`. Read-only: it changes no files and starts nothing. Returns one envelope with each service's state; a failure names the service and carries its last log lines. Optionally select the project with projectPath.",
    inputSchema: waitArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: waitRun,
  },
  {
    name: "logs",
    description:
      "A bounded snapshot of recent logs from the running stack (default the last 200 lines, at most 10000), returned as text. Read-only: reading with a cursor writes nothing. Not a stream: every JSON line has a `seq`, the response carries `data.nextCursor`, and passing that value back as `after` returns only newer lines (an unchanged log gives no lines and the same cursor; a cursor older than the retained log returns the oldest available lines with `data.truncated: true`). Optionally select the project with projectPath. After a failed `up`, call it first with unhealthy: true to read only the failing or still-starting services. Otherwise use `status` first to find which service is failing, then pass services to narrow the output and source `runtime` to skip image build output and read why it failed. For local-process services, pass run: current, previous or a run id to read one run apart from older ones.",
    inputSchema: logsArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildLogsArgs),
  },
  {
    name: "resource_list",
    description:
      "List the selected project's services (resources) with their stack, type, port and project-relative folder path, whether or not they are running. Read-only. Use `status` for live state, `stack_list` to group them by stack and `agent_list` for agents only. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: resourceListArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildResourceListArgs),
  },
  {
    name: "resource_restart",
    aliases: ["restart_resource"],
    description:
      "Restart one running resource in the stack along with any active container resources that transitively declare `sidecarOf` on it (Flisk-generated Compose containers restart without rebuilding their image; local-process resources of a project that runs without Tilt are restarted by the run that supervises them (its .env is re-read, only that service is stopped and started, and the result says whether it is `ready`, `failed` with its own output, or still starting); other non-container resources and projects using an imported Tiltfile fall back to `tilt trigger`); unrelated resources are not touched. It needs a running stack: start one with `up`. Set rebuild to true for a full Tilt update (rebuild the image and recreate the container, which re-reads the project .env). Names come from `resource_list`. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: resourceRestartArgs.inputSchema({ projectPath: true }),
    annotations: WRITES_LOCALLY,
    run: resourceRestartRun,
  },
  {
    name: "resource_run",
    description:
      "Run a one-off command (a seed script, a migration, a status check) with the environment one resource has in the stack, and return its exit code, stdout and stderr (the last 64 KB of each; values from the project's .env files are masked). It runs any command, so it is refused unless confirm is true: ask the user first. A container resource must be running (start it with `up`); a local-process resource runs from its folder. No input is passed. Names come from `resource_list`. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: resourceRunArgs.inputSchema({ projectPath: true }),
    annotations: {
      ...WRITES_LOCALLY,
      destructiveHint: true,
      openWorldHint: true,
    },
    run: viaCli(buildResourceRunArgs),
  },
  {
    name: "agent_list",
    aliases: ["list_agents"],
    description:
      "List AI agent resources (appType: 'agent') in the project with their stack, runtime, durability and port. Read-only. Use `resource_list` for every resource type, and `agent_sessions` to inspect one agent's sessions. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: agentListArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildAgentListArgs),
  },
  {
    name: "agent_sessions",
    aliases: ["get_agent_sessions"],
    description:
      "List the sessions of a running AI agent resource (id, last activity, status, checkpoint size), or read one session's checkpoint when sessionId is set. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: agentSessionsArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildAgentSessionsArgs),
  },
  {
    name: "stack_list",
    description:
      "List the project's stacks with their resource counts. Read-only. Use `resource_list` for the resources themselves. Set services to include each stack's service names, and verbose for its description. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: stackListArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildStackListArgs),
  },
  {
    name: "project_info",
    description:
      "Project root, whether the generated master files exist (data.configured, data.missingFiles), and resource and stack counts. Read-only; a quick first call to learn whether a folder is a configured Flisk project. Use `config_verify` to check that the generated files match, and `status` for the running stack. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: projectInfoArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildProjectInfoArgs),
  },
  {
    name: "project_templates",
    description:
      "List the starter templates project_init can clone (data.templates): each one's key, repo, description and what it needs to run (needs), plus the ref it checks out when pinned to a commit. Read-only; the same rows as `flisk project --list --json`. Pass a key as project_init's template.",
    inputSchema: OBJECT({}),
    annotations: READ_ONLY,
    run: projectTemplatesRun,
  },
  {
    name: "network_list",
    description:
      "The URL of every frontend and API service: its Traefik route, or its http://localhost:<port> address in a local-process project (one that runs with no Docker, no Tilt and no gateway). With its base path, port and whether it answers (running, stopped). Read-only. Use it to find where to open a service; use `status` for full readiness. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: networkListArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildNetworkListArgs),
  },
  {
    name: "config_verify",
    description:
      "Check that the generated files match .flisk/project.json and that every service.json is valid. By default returns a small summary: every error line and data.diffs entries with file, state (missing or different), linesAdded and linesRemoved, without file bodies. Pass diffFiles (paths from data.diffs, e.g. .flisk/.flisk-out/Tiltfile or Tiltfile) to request diffs for those files only, capped at 200 lines each with a truncation note; the CLI equivalent is flisk config verify --diff <file>. A drifted generated file is fixed with config_regenerate. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: configVerifyArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: (deps) => async (args) => {
      const result = await viaCli(buildConfigVerifyArgs)(deps)(args);
      return { ...result, text: summarizeConfigVerify(result.data) };
    },
  },
  {
    name: "config_explain",
    description:
      "Explain one project file: whether Flisk generated it or the user owns it, its source, whether it is edited now, whether editing it blocks `up`, and what to edit instead. Run it before editing a file you did not write. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: configExplainArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildConfigExplainArgs),
  },
  {
    name: "runtime_check",
    description:
      "Read-only. Check that the installed Flisk CLI has its bundled runtime assets (engine, templates). Returns ok, assetRoot and what is missing; a source checkout reports ok: false because the assets exist only in a packaged install. projectPath is optional: a project-local install under its node_modules is checked too.",
    inputSchema: runtimeCheckArgs.inputSchema({ projectPath: true }),
    annotations: READ_ONLY,
    run: viaCli(buildRuntimeCheckArgs),
  },
  {
    name: "config_regenerate",
    description:
      "Regenerate the master config files in .flisk/.flisk-out/ from .flisk/project.json. A dry run by default, which returns the planned changes as data.changes (each file's status and lineDiff) with data.hasChanges; set dryRun to false to write them and get the same list, which discards hand edits in those generated files. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: configRegenerateArgs.inputSchema({ projectPath: true }),
    annotations: {
      ...WRITES_LOCALLY,
      destructiveHint: true,
      idempotentHint: true,
    },
    run: viaCli(buildConfigRegenerateArgs),
  },
  {
    name: "resource_create",
    description:
      "Scaffold a new service (service.json, Dockerfile, source and a test) with `flisk resource <name> --json`, or register an existing directory that already has a service.json. Returns the structured envelope: data.action is `created` or `registered`, with data.name, data.path, data.port, data.type, data.stack, data.framework, data.language and data.discovered; a failure is errors with a code and suggestions. Without stack it uses the only existing stack or `main`, and fails when several stacks exist. Do not call it again for a resource that already exists: that rewrites its service.json and can assign it a new port (check with resource_list first). Call `up` afterwards to start it. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: resourceCreateArgs.inputSchema({ projectPath: true }),
    annotations: { ...WRITES_LOCALLY, destructiveHint: true },
    run: viaCli(buildResourceCreateArgs),
  },
  {
    name: "tool_add",
    description:
      "Add a tool by its everyday name (react, nextjs, fastapi, nodejs, postgresql, mysql, mongodb, rag, embeddings, llm-api) with `flisk tool add <tool> --json`, which runs the matching `flisk resource` command. data.status says what happened: resource (created; data.resource is the resource_create result), built-in (docker: nothing to do), manual (angular, tailwind, spring-boot, github-actions, jutro, policycenter: data.steps are steps to show the user; nothing was changed), or an error for a rejected tool (aws, google-cloud, azure, kubernetes): Flisk runs everything locally and never creates cloud resources, so do not work around it. Call `up` afterwards to start a new resource. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: toolAddArgs.inputSchema({ projectPath: true }),
    annotations: { ...WRITES_LOCALLY, destructiveHint: true },
    run: viaCli(buildToolAddArgs),
  },
  {
    name: "stack_assign",
    description:
      "Assign resources that have no stack yet to a stack (writes `stack` into their service.json). A resource already in a stack is refused unless move is true, which moves it out of its current stack. Returns the structured envelope: data.stack and data.assigned (name and service.json path of each resource), or errors with a code and suggestions (for example the valid resource names). Set projectPath when the MCP server is not running from the project root.",
    inputSchema: stackAssignArgs.inputSchema({ projectPath: true }),
    annotations: { ...WRITES_LOCALLY, idempotentHint: true },
    run: viaCli(buildStackAssignArgs),
  },
  {
    name: "project_init",
    description:
      "Create a Flisk project with `flisk project --yes`: in projectPath (an existing directory; default the server's directory) write .flisk/project.json and generate its files, or, with template, clone a starter project into a new directory there (then call project_init again with projectPath set to the clone to configure it). name sets project.name of a blank project (the folder's name otherwise). Inside an existing project it refreshes that project's generated files instead and never overwrites its project.json. Returns the command's text output.",
    inputSchema: projectInitArgs.inputSchema({
      projectPath: {
        type: "string",
        description:
          "Absolute path to an existing directory to create the project in (or to clone the template from)",
      },
    }),
    annotations: { ...WRITES_LOCALLY, openWorldHint: true },
    run: viaCliText(buildProjectInitArgs, { timeoutMs: PROJECT_INIT_TIMEOUT_MS }),
  },
  {
    name: "project_eject",
    description:
      "Write EJECTED.md with `flisk eject --json`: it lists the generated Tilt files and how to run the stack with plain Tilt, and copies, moves or deletes nothing. It changes the project, so it is refused unless confirm is true; dryRun returns the plan (data.generatedFiles, data.created) without confirm. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: projectEjectArgs.inputSchema({ projectPath: true }),
    annotations: { ...WRITES_LOCALLY, idempotentHint: true },
    run: viaCli(buildProjectEjectArgs),
  },
  {
    name: "project_import",
    description:
      "Import the services in a directory's root docker-compose.yml as bring-your-own service.json files with `flisk import --json`, which runs the pinned flisk-import from npm (the first run needs network access). It writes without asking: set dryRun to get the plan only, and force to overwrite an existing service.json (force needs confirm: true unless dryRun is set). Returns data.written, the plan's data.services, data.skipped and data.planned fields, and the importer's output. Set projectPath when the MCP server is not running from the project root.",
    inputSchema: projectImportArgs.inputSchema({ projectPath: true }),
    annotations: {
      ...WRITES_LOCALLY,
      destructiveHint: true,
      openWorldHint: true,
    },
    run: viaCli(buildProjectImportArgs, { timeoutMs: IMPORT_TIMEOUT_MS }),
  },
];
