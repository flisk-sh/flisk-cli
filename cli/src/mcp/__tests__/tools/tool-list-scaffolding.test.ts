// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { readFileSync } from "node:fs";

import { dirname, resolve } from "node:path";

import { fileURLToPath } from "node:url";

import type { Command } from "commander";

import { beforeEach, describe, expect, it } from "vitest";
import {
  createProjectFixture,
  loadRegisteredCommandMap,
  recordingTools,
  resetSpawnMock,
} from "./test-support.js";

beforeEach(() => {
  resetSpawnMock();
});

const fixture = createProjectFixture();

import { parseResourceType } from "../../../commands/resource.js";

import { CREATABLE_RESOURCE_TYPES, RESOURCE_CREATE_TYPE_VALUES } from "../../../types/index.js";

import { FliskError } from "../../../utils/errors.js";

import { PROJECT_TEMPLATES } from "../../../utils/project-templates.js";

import { createFliskTools, projectEjectArgs, projectImportArgs, upArgs } from "../../tools.js";

const testDir = dirname(fileURLToPath(import.meta.url));

const repoRoot = resolve(testDir, "../../../../..");

function checkDocCliInvocations(docText: string, commands: Map<string, Command>): string[] {
  const problems: string[] = [];
  const matches = [
    ...docText.matchAll(/`flisk\s+([a-z][\w-]*)(?:\s+([^`\n]*))?`/g),
    ...docText.matchAll(/^\s*flisk\s+([a-z][\w-]*)(?:\s+([^\n]*))?$/gm),
  ];
  for (const match of matches) {
    const subName = match[1];
    const rest = (match[2] ?? "").trim();
    const rootCmd = commands.get(subName);
    // `flisk <template>` (e.g. `flisk demo`) is a bare template dispatch, not a Commander command.
    if (!rootCmd && rest === "" && subName in PROJECT_TEMPLATES) {
      continue;
    }
    if (!rootCmd) {
      problems.push(`unknown command "flisk ${subName}"`);
      continue;
    }

    let targetCmd: Command = rootCmd;
    let tokens = rest ? rest.split(/\s+/) : [];
    if (tokens.length > 0 && rootCmd.commands.length > 0) {
      const sub = rootCmd.commands.find(
        (c) => c.name() === tokens[0] || c.aliases().includes(tokens[0]),
      );
      if (sub) {
        targetCmd = sub;
        tokens = tokens.slice(1);
      }
    }

    const validFlags = new Set(
      targetCmd.options.flatMap((opt) => [opt.long, opt.short].filter(Boolean) as string[]),
    );
    let idx = 0;
    let positionalCount = 0;
    while (idx < tokens.length) {
      const raw = tokens[idx];
      const stripped = raw.replace(/^\[+|\]+$/g, "");
      if (!stripped) {
        idx += 1;
        continue;
      }
      if (stripped.startsWith("-")) {
        const flagName = stripped.split("=")[0];
        if (!validFlags.has(flagName)) {
          problems.push(`flisk ${targetCmd.name()}: unknown flag "${flagName}" in "${match[0]}"`);
        }
        const opt = targetCmd.options.find((o) => o.long === flagName || o.short === flagName);
        if (
          opt &&
          (opt.required || opt.optional) &&
          !stripped.includes("=") &&
          idx + 1 < tokens.length &&
          !tokens[idx + 1].replace(/^\[+|\]+$/g, "").startsWith("-")
        ) {
          idx += 2;
          continue;
        }
      } else {
        positionalCount += 1;
      }
      idx += 1;
    }

    // A variadic last argument (`flisk tool add <tool...>`) takes any number of words, as in undeclaredArguments.
    const takesAny = targetCmd.registeredArguments.at(-1)?.variadic === true;
    if (!takesAny && positionalCount > targetCmd.registeredArguments.length) {
      problems.push(
        `flisk ${targetCmd.name()} takes ${targetCmd.registeredArguments.length} positional argument(s), but doc has ${positionalCount} in "${match[0]}"`,
      );
    }
  }
  return problems;
}

function undeclaredArguments(args: string[], commands: Map<string, Command>): string[] {
  const [name = "", ...rest] = args;
  const root = commands.get(name);
  if (!root) return [`unknown command "flisk ${name}"`];
  const sub = root.commands.find((c) => c.name() === rest[0]);
  const target = sub ?? root;
  const tokens = sub ? rest.slice(1) : rest;
  const declared = new Set(
    target.options.flatMap((opt) => [opt.long, opt.short].filter((f): f is string => Boolean(f))),
  );
  // Everything after `--` is an argument, never an option (`flisk run api -- printenv -0`).
  const end = tokens.indexOf("--");
  const options = end === -1 ? tokens : tokens.slice(0, end);
  const afterEnd = end === -1 ? [] : tokens.slice(end + 1);
  const problems = options
    .filter((token) => token.startsWith("-"))
    .map((token) => token.split("=")[0] ?? token)
    .filter((option) => !declared.has(option))
    .map((option) => `flisk ${target.name()}: unknown option "${option}"`);
  const positionals = options.filter((token) => !token.startsWith("-")).length + afterEnd.length;
  // A variadic last argument (`[command...]`) takes any number of values.
  const isVariadic = target.registeredArguments.at(-1)?.variadic === true;
  if (!isVariadic && positionals > target.registeredArguments.length) {
    problems.push(
      `flisk ${target.name()} takes ${target.registeredArguments.length} positional argument(s), got ${positionals}`,
    );
  }
  return problems;
}

describe("tool list", () => {
  it("runs the scaffolding tools non-interactively", async () => {
    const stdout = JSON.stringify({ schemaVersion: 1, data: {}, errors: [] });
    const { seen, tools } = recordingTools(stdout);
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    const created = await call("resource_create", {
      projectPath: fixture.projectDir,
      name: "api",
      type: "backend",
      stack: "shop",
    });
    // resource_create returns the command's --json envelope; project_init still returns its text output.
    expect(created).toEqual({
      data: { schemaVersion: 1, data: {}, errors: [] },
      isError: false,
    });
    await call("stack_assign", { stack: "shop", resources: ["api"] });
    const initialized = await call("project_init", { projectPath: fixture.projectDir });
    expect(initialized).toEqual({ data: { exitCode: 0, output: stdout }, isError: false });
    await call("project_init", { template: "agent-stack" });
    await call("config_regenerate", {});
    await call("config_regenerate", { dryRun: false });
    expect(seen).toEqual([
      {
        args: ["resource", "api", "--type=backend", "--stack=shop", "--json"],
        cwd: fixture.projectDir,
      },
      { args: ["stack", "shop", "--resources=api", "--json"], cwd: undefined },
      { args: ["project", "--yes"], cwd: fixture.projectDir, timeoutMs: 300_000 },
      { args: ["project", "agent-stack", "--yes"], cwd: undefined, timeoutMs: 300_000 },
      { args: ["config", "regenerate", "--dry-run", "--json"], cwd: undefined },
      { args: ["config", "regenerate", "--json"], cwd: undefined },
    ]);
    expect(tools.find((t) => t.name === "resource_create")?.inputSchema).toMatchObject({
      required: ["name"],
      properties: { type: { enum: [...RESOURCE_CREATE_TYPE_VALUES] } },
    });
    expect(tools.find((t) => t.name === "stack_assign")?.inputSchema).toMatchObject({
      required: ["stack", "resources"],
    });
    expect(tools.find((t) => t.name === "project_init")?.inputSchema).toMatchObject({
      properties: {
        template: { enum: Object.keys(PROJECT_TEMPLATES) },
        path: { description: expect.stringContaining("starter name") },
      },
    });
    expect(JSON.stringify(tools.find((t) => t.name === "project_init")?.inputSchema)).not.toContain(
      "force",
    );
  });

  it("offers resource_create every type the CLI scaffolds, inference included and sdk left out", async () => {
    const { seen, tools } = recordingTools("");
    const tool = tools.find((t) => t.name === "resource_create");
    const schema = tool?.inputSchema as { properties: { type: { enum: string[] } } };
    const offered = schema.properties.type.enum;
    expect(offered).toEqual([...RESOURCE_CREATE_TYPE_VALUES]);
    expect(offered).toEqual(expect.arrayContaining([...CREATABLE_RESOURCE_TYPES, "inference"]));
    // sdk only registers a package that already has a service.json; byo is an alias of bring-your-own.
    expect(offered).not.toContain("sdk");
    expect(offered).not.toContain("byo");
    // Redis, Qdrant, MinIO, MLflow, NATS and RabbitMQ are frameworks of database and queue, not types.
    expect(offered).toEqual(expect.arrayContaining(["database", "queue"]));
    for (const removed of ["redis", "qdrant", "rabbitmq", "minio", "mlflow"]) {
      expect(offered).not.toContain(removed);
    }
    const description = JSON.stringify(tool?.inputSchema);
    expect(description).toContain("Queue: nats (default), rabbitmq");
    expect(description).toContain("Database: postgres (default");
    for (const type of offered) {
      // Every value the tool offers is one `flisk resource --type` accepts, so the two cannot drift.
      expect(() => parseResourceType(type), type).not.toThrow();
      await tool?.handler({ name: "api", type });
    }
    expect(seen.map((run) => run.args)).toEqual(
      offered.map((type) => ["resource", "api", `--type=${type}`, "--json"]),
    );
  });

  it("reports a scaffold failure that printed no envelope with its stderr", async () => {
    const { tools } = recordingTools("", { exitCode: 1, stderr: "❌ Directory already exists" });
    const result = await tools
      .find((t) => t.name === "resource_create")
      ?.handler({ name: "api", stack: "shop" });
    expect(result).toEqual({
      data: { errors: [{ code: "NO_JSON", message: "❌ Directory already exists" }] },
      isError: true,
    });
  });

  it("rejects invalid scaffolding arguments before running the CLI", async () => {
    const { seen, tools } = recordingTools("");
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    await expect(call("resource_create", { name: "" })).rejects.toThrow("name is required");
    await expect(call("resource_create", { name: "api", type: "lambda" })).rejects.toThrow(
      "type must be one of",
    );
    await expect(call("stack_assign", { stack: "shop", resources: [] })).rejects.toThrow(
      "resources must name at least one resource",
    );
    await expect(call("project_init", { template: "nope" })).rejects.toThrow(
      "template must be one of",
    );
    await expect(call("project_init", { projectPath: "new-app" })).rejects.toThrow(
      "projectPath must be an absolute path",
    );
    await expect(call("config_regenerate", { dryRun: "no" })).rejects.toThrow(
      "dryRun must be a boolean",
    );
    expect(seen).toEqual([]);
  });

  it("says what to try next when it rejects a new tool's argument", async () => {
    const { tools } = recordingTools("");
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    const rejected: [string, Record<string, unknown>][] = [
      ["resource_create", {}],
      ["resource_create", { name: "api", type: "lambda" }],
      ["resource_create", { name: "api", port: 0 }],
      ["stack_assign", { resources: ["api"] }],
      ["stack_assign", { stack: "shop", resources: [] }],
      ["project_init", { path: "elsewhere" }],
      ["project_init", { template: "saas", agentSkills: false }],
      ["config_explain", {}],
      ["config_explain", { file: "-x" }],
      ["project_eject", {}],
      ["project_eject", { confirm: "yes" }],
      ["project_import", { dir: "-x" }],
      ["project_import", { force: 1 }],
    ];
    for (const [name, args] of rejected) {
      const error = await Promise.resolve(call(name, args)).catch((e: unknown) => e);
      expect(error, `${name} ${JSON.stringify(args)}`).toBeInstanceOf(FliskError);
      expect((error as FliskError).suggestions.length).toBeGreaterThan(0);
    }
  });

  it("says what to try next when it rejects any tool's argument, with the message unchanged", async () => {
    const { seen, tools } = recordingTools("");
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    const rejected: [string, Record<string, unknown>, string][] = [
      ["resource_restart", {}, "resource is required"],
      ["resource_restart", { resource: "-x" }, "resource must be a name"],
      ["resource_run", { command: ["true"] }, "resource is required"],
      ["resource_run", { resource: "api" }, "command is required"],
      ["resource_run", { resource: "api", command: [] }, "command is required"],
      ["agent_sessions", {}, "resource is required"],
      ["agent_list", { stack: "a b" }, "stack must be a name"],
      ["logs", { services: ["ok", "-bad"] }, "services must be an array of names"],
      ["logs", { tail: 0 }, "tail must be a positive integer"],
      ["logs", { since: "soon" }, "since must be a duration such as 30s, 5m or 1h"],
      ["logs", { run: "latest" }, "run must be current, previous or a run id"],
      ["doctor", { noPing: "yes" }, "noPing must be a boolean"],
      ["doctor", { problemsOnly: "yes" }, "problemsOnly must be a boolean"],
      ["status", { projectPath: "relative" }, "projectPath must be an absolute path"],
      ["up", { only: ["-x"] }, "only must be an array of names"],
    ];
    for (const [name, args, message] of rejected) {
      const error = await Promise.resolve(call(name, args)).catch((e: unknown) => e);
      expect(error, `${name} ${JSON.stringify(args)}`).toBeInstanceOf(FliskError);
      expect((error as FliskError).message).toContain(message);
      expect((error as FliskError).suggestions.length).toBeGreaterThan(0);
    }
    expect(seen).toEqual([]);
  });

  it("refuses project_eject without confirm, and runs it with confirm or as a dry run", async () => {
    const { seen, tools } = recordingTools(
      '{"schemaVersion":1,"data":{"created":true},"errors":[]}',
    );
    const eject = tools.find((t) => t.name === "project_eject");
    await expect(eject?.handler({})).rejects.toThrow("it needs confirm: true");
    await expect(eject?.handler({ confirm: false })).rejects.toThrow("it needs confirm: true");
    expect(seen).toEqual([]);

    const result = await eject?.handler({ projectPath: fixture.projectDir, confirm: true });
    expect(result).toEqual({
      data: { schemaVersion: 1, data: { created: true }, errors: [] },
      isError: false,
    });
    await eject?.handler({ dryRun: true });
    expect(seen).toEqual([
      { args: ["eject", "--yes", "--json"], cwd: fixture.projectDir },
      { args: ["eject", "--dry-run", "--json"], cwd: undefined },
    ]);
    expect(projectEjectArgs.build({ confirm: true, dryRun: true })).toEqual([
      "eject",
      "--dry-run",
      "--json",
    ]);
    expect(eject?.inputSchema).toMatchObject({
      properties: { confirm: { type: "boolean" }, dryRun: { type: "boolean" } },
    });
  });

  it("runs project_import through flisk import --json with the directory before its flags", async () => {
    const { seen, tools } = recordingTools(
      '{"schemaVersion":1,"data":{"written":["services/legacy/api/service.json"]},"errors":[]}',
    );
    const call = (args: Record<string, unknown>) =>
      tools.find((t) => t.name === "project_import")?.handler(args);
    const result = await call({ projectPath: fixture.projectDir, dir: "legacy" });
    expect(result?.isError).toBe(false);
    await call({ dryRun: true });
    await call({ dir: "/srv/legacy", dryRun: true, force: true });
    expect(seen).toEqual([
      { args: ["import", "legacy", "--json"], cwd: fixture.projectDir, timeoutMs: 300_000 },
      { args: ["import", "--dry-run", "--json"], cwd: undefined, timeoutMs: 300_000 },
      {
        args: ["import", "/srv/legacy", "--dry-run", "--force", "--json"],
        cwd: undefined,
        timeoutMs: 300_000,
      },
    ]);
    expect(projectImportArgs.build({})).toEqual(["import", "--json"]);
  });

  it("reports a failed import envelope as an error result", async () => {
    const { tools } = recordingTools(
      '{"schemaVersion":1,"data":null,"errors":[{"code":"IMPORT_FAILED","message":"Nothing to import"}]}',
      { exitCode: 1 },
    );
    const result = await tools.find((t) => t.name === "project_import")?.handler({});
    expect(result?.isError).toBe(true);
  });

  it("keeps the old verb-first names callable without listing them", () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const aliases = Object.fromEntries(
      tools.flatMap((t) => (t.aliases ?? []).map((alias) => [alias, t.name])),
    );
    expect(aliases).toEqual({
      restart_resource: "resource_restart",
      list_agents: "agent_list",
      get_agent_sessions: "agent_sessions",
    });
    const names = tools.map((t) => t.name);
    for (const alias of Object.keys(aliases)) expect(names).not.toContain(alias);
  });

  it("passes only arguments and options that the target CLI command declares", async () => {
    const commands = loadRegisteredCommandMap();
    const { seen, tools } = recordingTools('{"schemaVersion":1,"data":{},"errors":[]}');
    // Every tool that runs the CLI directly, with every option it can pass.
    const calls: Record<string, Record<string, unknown>> = {
      doctor: { noPing: true, problemsOnly: true },
      down: { dryRun: true },
      status: {},
      wait: { services: ["api"], timeoutSeconds: 5 },
      logs: { services: ["api"], tail: 5, since: "5m", run: "previous" },
      resource_list: { stack: "shop" },
      resource_restart: { resource: "api" },
      resource_run: { resource: "api", command: ["printenv", "DATABASE_URL"], confirm: true },
      agent_list: { stack: "shop" },
      agent_sessions: { resource: "bot", sessionId: "s1" },
      stack_list: { services: true, verbose: true },
      project_info: {},
      network_list: { stack: "shop" },
      config_verify: {},
      config_explain: { file: "service.json" },
      runtime_check: {},
      config_regenerate: { dryRun: true },
      resource_create: {
        name: "bot",
        type: "agent",
        stack: "shop",
        framework: "hono",
        language: "bun",
        port: 4800,
        features: ["prisma"],
        runtime: "custom",
        durability: "files",
      },
      tool_add: { tool: "react", name: "web", stack: "shop", dryRun: true },
      stack_assign: { stack: "shop", resources: ["api", "web"] },
      project_init: { agentSkills: false },
      project_eject: { confirm: true },
      project_import: { dir: "legacy", dryRun: true, force: true, confirm: true },
    };
    expect(Object.keys(calls).sort()).toEqual(
      tools
        .map((t) => t.name)
        .filter((name) => name !== "up" && name !== "project_templates")
        .sort(),
    );
    for (const [name, args] of Object.entries(calls)) {
      await tools.find((t) => t.name === name)?.handler(args);
    }
    await tools.find((t) => t.name === "project_init")?.handler({ template: "saas", path: "app" });
    await tools.find((t) => t.name === "project_eject")?.handler({ dryRun: true });
    expect(seen).toHaveLength(Object.keys(calls).length + 2);
    for (const { args } of seen) expect(undeclaredArguments(args, commands)).toEqual([]);
    expect(
      undeclaredArguments(
        upArgs.build({ stack: "shop", only: ["api"], force: true, dryRun: true }),
        commands,
      ),
    ).toEqual([]);

    // The check itself catches an unknown option and a surplus positional argument.
    expect(undeclaredArguments(["stacks", "--bogus"], commands)).toEqual([
      'flisk stacks: unknown option "--bogus"',
    ]);
    expect(undeclaredArguments(["config", "verify", "extra"], commands)).toEqual([
      "flisk verify takes 0 positional argument(s), got 1",
    ]);
  });

  it("keeps docs/agents/llms.txt and docs/agents/llms-full.txt in sync with MCP tools and CLI commands", async () => {
    const toolsSource = readFileSync(resolve(testDir, "../../tools/table.ts"), "utf-8");
    const sourceToolNames = [...toolsSource.matchAll(/^\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]);
    const runtimeToolNames = createFliskTools(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    })).map((t) => t.name);
    expect(sourceToolNames).toEqual(runtimeToolNames);

    const commands = loadRegisteredCommandMap();
    expect(commands.size).toBeGreaterThan(10);

    for (const relPath of ["docs/agents/llms.txt", "docs/agents/llms-full.txt"]) {
      const content = readFileSync(resolve(repoRoot, relPath), "utf-8");
      for (const toolName of sourceToolNames) {
        expect(
          content,
          `${relPath} must document MCP tool "${toolName}" with a one-line description`,
        ).toMatch(new RegExp(`^\\s*-\\s*\`${toolName}\`:\\s+\\S+`, "m"));
      }
      expect(checkDocCliInvocations(content, commands), `CLI command drift in ${relPath}`).toEqual(
        [],
      );
    }

    // Verify the checker rejects `flisk down [stack]` and unknown flags
    expect(checkDocCliInvocations("- `flisk down [stack] [--json]`", commands)).toEqual([
      'flisk down takes 0 positional argument(s), but doc has 1 in "`flisk down [stack] [--json]`"',
    ]);
    expect(checkDocCliInvocations("- `flisk down [--bogus]`", commands)).toEqual([
      'flisk down: unknown flag "--bogus" in "`flisk down [--bogus]`"',
    ]);
  });
});
