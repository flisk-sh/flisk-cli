// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { RESOURCE_CREATE_TYPE_VALUES } from "../../../types/index.js";
import {
  collectSidecarDependents,
  isGeneratedComposeContainer,
  resolveRestartCliTimeoutMs,
  resolveRestartSequenceCliTimeoutMs,
} from "../../../utils/container-restart.js";
import { FliskError } from "../../../utils/errors.js";
import { findProjectRoot } from "../../../utils/paths.js";
import { isLocalScaffoldType, LOCAL_SCAFFOLD_TYPE_LIST } from "../../../utils/resource-local.js";
import {
  clearDiscoveryResultCache,
  discoverResourcesWithProblems,
} from "../../../utils/services.js";
import { addableToolIds, findTool, toolIds } from "../../../utils/tool-catalog.js";
import { KEBAB_CASE_REGEX } from "../../../utils/validation.js";
import type { McpToolResult } from "../../server.js";
import { argSpec, flag, guard, mcpArg, option, optionalName, positional } from "../../spec-args.js";
import { type RunFlisk, toToolResult } from "../run.js";
import { creatableResourceName, projectPath } from "../shared.js";

/**
 * The resource family: listing and inspecting resources (`resource_list`, `agent_list`, `agent_sessions`), acting on a
 * running one (`resource_restart`, `resource_run`) and scaffolding a new one (`resource_create`, `tool_add`, which runs
 * the matching `flisk resource` command). Each tool's arguments are declared once in an argSpec table bound to the
 * command's generated spec.
 */

/** The `resource_list` tool's arguments, bound to the `flisk resources` spec. */
export const resourceListArgs = argSpec(
  ["resources"],
  ["--json", option("--stack", { as: "name", description: "Only this stack" })],
);

/** `flisk resources [--stack=<stack>] --json`. */
export function buildResourceListArgs(args: Record<string, unknown>): string[] {
  return resourceListArgs.build(args);
}

/** The `agent_list` tool's arguments, bound to the `flisk resources` spec. */
export const agentListArgs = argSpec(
  ["resources"],
  ["--type=agent", "--json", option("--stack", { as: "name", description: "Only this stack" })],
);

/** `flisk resources --type=agent [--stack=<stack>] --json` for agent_list. */
export function buildAgentListArgs(args: Record<string, unknown>): string[] {
  return agentListArgs.build(args);
}

/** The `agent_sessions` tool's arguments, bound to the `flisk agent sessions` spec. */
export const agentSessionsArgs = argSpec(
  ["agent", "sessions"],
  [
    positional("resource", {
      required: true,
      suggestions: ["Pass the agent resource name; agent_list shows them"],
      description: "Name of the agent resource",
    }),
    option("--session-id", {
      arg: "sessionId",
      as: "name",
      description: "Session ID to read; omit it to list all sessions",
    }),
    "--json",
  ],
);

/** `flisk agent sessions <resource> [--session-id=<id>] --json`. */
export function buildAgentSessionsArgs(args: Record<string, unknown>): string[] {
  return agentSessionsArgs.build(args);
}

/** The `resource_restart` tool's arguments, bound to the `flisk restart` spec. */
export const resourceRestartArgs = argSpec(
  ["restart"],
  [
    positional("resource", {
      required: true,
      // Not in schema.required: the tool works as documented without advertising it there.
      schemaRequired: false,
      suggestions: ["Pass the resource name; resource_list shows them"],
      description: "Name of the resource to restart",
    }),
    "--json",
    option("--wait", {
      arg: "waitSeconds",
      as: "number",
      default: 60,
      description:
        "Local-process stacks: how long to wait for the service to be ready again (default 60, max 300; 0 returns once the restart has begun)",
    }),
    option("--rebuild", {
      description: "Rebuild the image and recreate the container through Tilt",
    }),
  ],
);

/** `flisk restart <resource> --json`; the waitSeconds bound is clamped where the handler runs it. */
export function buildResourceRestartArgs(args: Record<string, unknown>): string[] {
  return resourceRestartArgs.build(args);
}

function restartCliTimeoutMs(
  cwd: string | undefined,
  resourceName: string,
  rebuild = false,
): number {
  const root = findProjectRoot(cwd);
  if (!root) return resolveRestartCliTimeoutMs();
  try {
    clearDiscoveryResultCache(root);
    const { resources } = discoverResourcesWithProblems(root);
    const resource = resources.find((candidate) => candidate.name === resourceName);
    if (!resource) return resolveRestartCliTimeoutMs();
    if (!rebuild && isGeneratedComposeContainer(resource)) {
      const targets = [resource, ...collectSidecarDependents(resources, resourceName)];
      return resolveRestartSequenceCliTimeoutMs(
        targets.map((target) => target.config?.container?.stopGracePeriod),
      );
    }
    return resolveRestartCliTimeoutMs(resource.config?.container?.stopGracePeriod);
  } catch {
    return resolveRestartCliTimeoutMs();
  }
}

/** The `resource_restart` row's handler: a `flisk restart` whose CLI timeout follows the resource's stop grace period. */
export const resourceRestartRun =
  ({ run }: { run: RunFlisk }) =>
  async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const resource = optionalName(args.resource, "resource");
    if (!resource) {
      throw new FliskError("resource is required", [
        "Pass the resource name; resource_list shows them",
      ]);
    }
    const cwd = projectPath(args.projectPath);
    const rebuild = flag(args.rebuild, "rebuild");
    const waitSeconds =
      typeof args.waitSeconds === "number" ? Math.min(Math.max(args.waitSeconds, 0), 300) : 60;
    const cliArgs = resourceRestartArgs.build({ ...args, waitSeconds });
    return toToolResult(
      await run(cliArgs, {
        cwd,
        // A local-process restart waits for readiness inside the command: allow for that wait.
        timeoutMs: Math.max(
          restartCliTimeoutMs(cwd, resource, rebuild),
          waitSeconds * 1000 + 30_000,
        ),
      }),
    );
  };

/** The `resource_run` tool's arguments, bound to the `flisk run` spec. */
export const resourceRunArgs = argSpec(
  ["run"],
  [
    positional("service", {
      arg: "resource",
      required: true,
      suggestions: ["Pass the resource name; resource_list shows them"],
      description: "Name of the resource whose environment the command gets",
    }),
    "--json",
    "--",
    positional("command", {
      as: "strings",
      required: true,
      requiredMessage: "command is required",
      minItems: 1,
      suggestions: ['Pass the program and its arguments, for example ["node", "scripts/seed.js"]'],
      description: 'The program and its arguments, for example ["node", "scripts/seed.js"]',
    }),
    guard((args) => {
      if (flag(args.confirm, "confirm")) return;
      // The resource and command rows already validated these values; re-read them for the message.
      const resource = optionalName(args.resource, "resource") ?? "";
      const command = (Array.isArray(args.command) ? args.command : [])
        .filter((part): part is string => typeof part === "string")
        .join(" ");
      throw new FliskError(
        `resource_run runs \`${command}\` in the ${resource} environment; it needs confirm: true`,
        [
          "Ask the user to approve this command, then call resource_run again with confirm: true",
          "For read-only inspection use status, logs or resource_list, which need no confirm",
        ],
      );
    }),
    mcpArg("confirm", {
      type: "boolean",
      description:
        "Must be true to run the command: it runs arbitrary code in the resource's environment",
    }),
  ],
);

/** `flisk run <resource> -- <command...>` for resource_run; refused without `confirm: true` since it runs any command. */
export function buildResourceRunArgs(args: Record<string, unknown>): string[] {
  return resourceRunArgs.build(args);
}

/** The catalog id behind `tool add`'s first positional, or the same refusal the table gives for an unknown one. */
function toolId(value: unknown, arg: string): unknown {
  if (typeof value !== "string" || !value.trim()) {
    throw new FliskError(`${arg} is required`, [`Pass one of: ${addableToolIds().join(", ")}`]);
  }
  // The CLI's own spelling rules: "Next.js", "google cloud" and "Spring Boot" resolve, so a rejected tool reaches the
  // CLI and returns why it is rejected instead of a bare enum error.
  const tool = findTool(value)?.id;
  if (!tool) {
    throw new FliskError(`Flisk does not know the tool "${value}"`, [
      `Pass one of: ${addableToolIds().join(", ")}`,
    ]);
  }
  return tool;
}

/** The `tool_add` tool's arguments, bound to the `flisk tool add` spec. */
export const toolAddArgs = argSpec(
  ["tool", "add"],
  [
    positional("tool-and-name", {
      arg: "tool",
      as: "raw",
      required: true,
      requiredMessage: "tool is required",
      suggestions: [`Pass one of: ${addableToolIds().join(", ")}`],
      coerce: toolId,
      description: `The tool to add, by id or everyday name ("Next.js", "google cloud"): ${toolIds().join(", ")}`,
    }),
    positional("tool-and-name", {
      arg: "name",
      // The spec argument is variadic (tool words plus name); this row binds only its second value.
      as: "name",
      description:
        "Resource name (default per tool, for example web, server, db); a name already in use is refused",
    }),
    "--json",
    option("--stack", { as: "name", description: "Stack to assign the resource to" }),
    option("--dry-run", { arg: "dryRun" }),
  ],
);

/** `flisk tool add <tool> [name] --json` for the tool_add tool; the tool must be one the catalog knows. */
export function buildToolAddArgs(args: Record<string, unknown>): string[] {
  return toolAddArgs.build(args);
}

/** The `resource_create` tool's arguments, bound to the `flisk resource` spec. */
export const resourceCreateArgs = argSpec(
  ["resource"],
  [
    positional("name", {
      required: true,
      // The CLI's own kebab-case validator: the shared name pattern also lets ".", "_" and
      // uppercase through, so the tool refuses names the command would (#5235). "raw" so
      // creatableResourceName's own messages (type check, required, validity) reach the caller.
      as: "raw",
      coerce: (value) => creatableResourceName(value),
      schema: { pattern: KEBAB_CASE_REGEX.source },
      suggestions: ["Pass a kebab-case name, for example orders-api"],
      description:
        "Resource name (kebab-case: lowercase letters, digits and hyphens, for example my-service)",
    }),
    option("--type", {
      as: "choice",
      choices: RESOURCE_CREATE_TYPE_VALUES,
      description:
        "Resource type (default backend). Redis, Qdrant, MinIO, MLflow, MySQL, MongoDB, ClickHouse, NATS, RabbitMQ, Mailpit and stripe-mock are frameworks: type database, queue, storage, mail or payment plus framework",
    }),
    option("--stack", { as: "name", description: "Stack to assign the resource to" }),
    option("--framework", {
      as: "name",
      description:
        "Frontend: react (default), vue, svelte, preact, lit, solid, qwik, vanilla, tanstack-router, next. Backend: hono (default), express, elysia, fastify, nestjs, koa, h3. Database: postgres (default, the shared Flisk Postgres), redis, qdrant, mlflow, mysql, mongodb, clickhouse (each its own container; the services that list it in dependsOn get its connection settings). Queue: nats (default), rabbitmq. Storage: minio (default). Mail: mailpit (default, local SMTP and inbox). Payment: stripe-mock (default, Stripe API emulator)",
    }),
    option("--language", {
      as: "name",
      description: "Backend language: bun (default), python, go, rust, node",
    }),
    option("--port", {
      as: "port",
      description: "Port within the type's range (default: the next free one)",
    }),
    option("--feature", {
      arg: "features",
      description: "Resource features to enable, for example prisma or drizzle",
    }),
    option("--runtime", {
      as: "name",
      description: "Agent runtime (type agent only): custom",
    }),
    option("--durability", {
      as: "name",
      description: "Where agent sessions are checkpointed (type agent only): files or postgres",
    }),
    option("--local", {
      description:
        "Frontend, backend, worker, mcp or agent: scaffold it to run on this computer with no Docker or Tilt (a command in service.json; a plain Vite config for a frontend), the way flisk create does by default",
    }),
    // Same rule as `flisk resource --local`, checked here so an agent gets it as a tool error
    // before any command runs.
    guard((args) => {
      const type = args.type;
      if (flag(args.local, "local") && typeof type === "string" && !isLocalScaffoldType(type)) {
        throw new FliskError(`local applies to type ${LOCAL_SCAFFOLD_TYPE_LIST}, not ${type}`, [
          "Leave local out to scaffold it for Docker and Tilt",
        ]);
      }
    }),
    "--json",
  ],
);

/** `flisk resource <name> ... --json`: options as `--flag=value`, after the name, so a variadic `--feature` never takes it. */
export function buildResourceCreateArgs(args: Record<string, unknown>): string[] {
  return resourceCreateArgs.build(args);
}
