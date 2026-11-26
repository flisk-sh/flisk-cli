// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import {
  fakeUp,
  loadRegisteredCommandMap,
  recordingTools,
  resetSpawnMock,
} from "./test-support.js";

beforeEach(() => {
  resetSpawnMock();
});

import { FliskError } from "../../../utils/errors.js";
import { TOOL_TABLE } from "../../tools/table.js";
import { createFliskTools } from "../../tools.js";

describe("tool annotations", () => {
  const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "{}", stderr: "" }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  it("gives every tool behavior hints", () => {
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });

  it("marks the inspection tools read-only and the rest as writes", () => {
    const readOnly = [
      "doctor",
      "status",
      "wait",
      "logs",
      "resource_list",
      "agent_list",
      "agent_sessions",
      "stack_list",
      "project_info",
      "project_templates",
      "network_list",
      "config_verify",
      "config_explain",
      "runtime_check",
    ];
    for (const name of readOnly) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    }
    for (const tool of tools.filter((t) => !readOnly.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
    }
  });

  it("maps every read-only MCP tool to a registered CLI command or lists it as MCP-only", () => {
    const commands = loadRegisteredCommandMap();
    const mcpOnlyReadTools = new Set<string>(["project_templates"]);
    const readOnlyToolToCli: Record<string, [string] | [string, string]> = {
      doctor: ["doctor"],
      status: ["status"],
      wait: ["wait"],
      logs: ["logs"],
      resource_list: ["resources"],
      agent_list: ["agent", "list"],
      agent_sessions: ["agent", "sessions"],
      stack_list: ["stacks"],
      project_info: ["info"],
      network_list: ["networks"],
      config_verify: ["config", "verify"],
      config_explain: ["config", "explain"],
      runtime_check: ["runtime"],
    };

    const readOnlyTools = tools.filter((t) => t.annotations?.readOnlyHint === true);
    expect(readOnlyTools.length).toBeGreaterThan(0);

    for (const tool of readOnlyTools) {
      if (mcpOnlyReadTools.has(tool.name)) {
        expect(
          readOnlyToolToCli[tool.name],
          `${tool.name} cannot be both MCP-only and CLI-mapped`,
        ).toBeUndefined();
        continue;
      }

      const cliPath = readOnlyToolToCli[tool.name];
      expect(
        cliPath,
        `Read-only MCP tool "${tool.name}" must be mapped to a CLI command or listed in mcpOnlyReadTools`,
      ).toBeDefined();

      const [rootName, subName] = cliPath;
      const rootCmd = commands.get(rootName);
      expect(rootCmd, `CLI command "flisk ${rootName}" for tool "${tool.name}"`).toBeDefined();

      const targetCmd = subName
        ? rootCmd?.commands.find((c) => c.name() === subName || c.aliases().includes(subName))
        : rootCmd;
      expect(
        targetCmd,
        `CLI command "flisk ${cliPath.join(" ")}" for read-only MCP tool "${tool.name}"`,
      ).toBeDefined();

      const hasJsonOption = targetCmd?.options.some((opt) => opt.long === "--json");
      expect(hasJsonOption, `CLI command "flisk ${cliPath.join(" ")}" must support --json`).toBe(
        true,
      );

      // When a read-only tool is named `<group>_<subcommand>` and `flisk <group>` is a command group with subcommands,
      // `flisk <group> <subcommand>` must exist so CLI users following MCP naming do not hit "unknown command".
      const parts = tool.name.split("_");
      if (parts.length === 2) {
        const [groupName, actionName] = parts;
        const groupCmd = commands.get(groupName);
        if (groupCmd && groupCmd.commands.length > 0) {
          const matchingSub = groupCmd.commands.find(
            (c) => c.name() === actionName || c.aliases().includes(actionName),
          );
          expect(
            matchingSub,
            `Read-only tool "${tool.name}" implies "flisk ${groupName} ${actionName}" on command group "${groupName}"`,
          ).toBeDefined();
        }
      }
    }
  });

  it("flags the tools that can discard or overwrite files as destructive", () => {
    for (const name of [
      "down",
      "config_regenerate",
      "resource_create",
      "tool_add",
      "project_import",
    ]) {
      expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(true);
    }
  });
});

describe("confirm safeguards and output masking", () => {
  it("refuses resource_run without confirm, with a message the agent can act on", async () => {
    const { seen, tools } = recordingTools("{}");
    const run = tools.find((t) => t.name === "resource_run");
    await expect(run?.handler({ resource: "api", command: ["node", "seed.js"] })).rejects.toThrow(
      "needs confirm: true",
    );
    await expect(
      run?.handler({ resource: "api", command: ["node", "seed.js"], confirm: false }),
    ).rejects.toThrow("confirm: true");
    expect(seen).toEqual([]);
    await run?.handler({ resource: "api", command: ["node", "seed.js"], confirm: true });
    expect(seen.map((s) => s.args)).toEqual([["run", "api", "--json", "--", "node", "seed.js"]]);
  });

  it("refuses project_import with force unless confirm or dryRun", async () => {
    const { seen, tools } = recordingTools("{}");
    const imp = tools.find((t) => t.name === "project_import");
    await expect(imp?.handler({ force: true })).rejects.toThrow("needs confirm: true");
    expect(seen).toEqual([]);
    await imp?.handler({});
    await imp?.handler({ force: true, dryRun: true });
    await imp?.handler({ force: true, confirm: true });
    expect(seen.map((s) => s.args)).toEqual([
      ["import", "--json"],
      ["import", "--dry-run", "--force", "--json"],
      ["import", "--force", "--json"],
    ]);
  });

  it("no longer suggests printenv of a secret in the resource_run description", () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const run = tools.find((t) => t.name === "resource_run");
    expect(JSON.stringify(run)).not.toContain("DATABASE_URL");
  });

  it("masks a .env value in the resource_run result", async () => {
    const secretDir = mkdtempSync(join(tmpdir(), "flisk-mcp-secret-"));
    try {
      mkdirSync(join(secretDir, ".flisk"), { recursive: true });
      writeFileSync(join(secretDir, ".flisk", "project.json"), JSON.stringify({ name: "s" }));
      writeFileSync(
        join(secretDir, ".env"),
        "DATABASE_URL=postgres://u:hunter2-very-secret@db/app\n",
      );
      const stdout = JSON.stringify({
        schemaVersion: 1,
        data: { exitCode: 0, stdout: "postgres://u:hunter2-very-secret@db/app\n", stderr: "" },
        errors: [],
      });
      const { tools } = recordingTools(stdout);
      const result = await tools
        .find((t) => t.name === "resource_run")
        ?.handler({
          projectPath: secretDir,
          resource: "api",
          command: ["env"],
          confirm: true,
        });
      expect(JSON.stringify(result)).not.toContain("hunter2-very-secret");
      expect(JSON.stringify(result)).toContain("[REDACTED]");
    } finally {
      rmSync(secretDir, { recursive: true, force: true });
    }
  });
});

describe("unknown arguments over the real tool registry", () => {
  it("refuses a made-up argument on every tool without running the CLI", async () => {
    const { createMcpServer } = await import("../../server.js");
    const { seen, tools } = recordingTools("{}");
    const server = createMcpServer(tools, { name: "flisk", version: "1.0.0" });
    for (const tool of tools) {
      const line = await server.handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: tool.name, arguments: { bogusArgument: 1 } },
        }),
      );
      const result = (
        JSON.parse(line as string) as { result: { isError: boolean; content: { text: string }[] } }
      ).result;
      expect(result.isError, tool.name).toBe(true);
      expect(result.content[0]?.text, tool.name).toContain("Unknown argument: bogusArgument");
    }
    expect(seen).toEqual([]);
  });
  it("points logs {resource} at services and resource_restart {name} at resource", async () => {
    const { createMcpServer } = await import("../../server.js");
    const { tools } = recordingTools("{}");
    const server = createMcpServer(tools, { name: "flisk", version: "1.0.0" });
    const text = async (name: string, args: unknown): Promise<string> => {
      const line = await server.handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      );
      return (
        (JSON.parse(line as string) as { result: { content: { text: string }[] } }).result
          .content[0]?.text ?? ""
      );
    };
    expect(await text("logs", { resource: "agent" })).toContain(
      `Did you mean "services" instead of "resource"?`,
    );
    expect(await text("resource_restart", { name: "agent" })).toContain(
      `Did you mean "resource" instead of "name"?`,
    );
  });
});

describe("the tool data table", () => {
  it("has a name, description, schema and run adapter on every row", () => {
    const seen = new Set<string>();
    for (const spec of TOOL_TABLE) {
      expect(spec.name, spec.name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      expect(seen.has(spec.name), spec.name).toBe(false);
      seen.add(spec.name);
      expect(spec.description.trim(), spec.name).toMatch(/[.!?]["')`]?$/);
      expect(spec.inputSchema.type, spec.name).toBe("object");
      expect(spec.annotations, spec.name).toBeDefined();
      expect(typeof spec.run, spec.name).toBe("function");
      for (const alias of spec.aliases ?? []) expect(typeof alias).toBe("string");
    }
    expect(seen.size).toBe(TOOL_TABLE.length);
  });

  it("maps every row to an McpTool and runs it through the generic handler path", async () => {
    const { seen, tools } = recordingTools("{}", {}, fakeUp({ logs: [""] }).deps);
    expect(tools.map((t) => t.name)).toEqual(TOOL_TABLE.map((spec) => spec.name));
    for (const tool of tools) {
      expect(typeof tool.description, tool.name).toBe("string");
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.annotations, tool.name).toBeDefined();
      expect(typeof tool.handler, tool.name).toBe("function");
      const before = seen.length;
      try {
        // waitSeconds: 0 returns `up`'s detached child at once; the other rows ignore the argument.
        const result = await tool.handler({ waitSeconds: 0 });
        expect(typeof result.isError, tool.name).toBe("boolean");
        expect(result, tool.name).toHaveProperty("data");
        if (seen.length > before) {
          expect(
            seen.at(-1)?.args.every((arg) => typeof arg === "string"),
            tool.name,
          ).toBe(true);
        }
      } catch (error) {
        // A row with required arguments rejects before the CLI runs; its run adapter is still exercised.
        expect(error, tool.name).toBeInstanceOf(FliskError);
      }
    }
    // The CLI-backed rows all reached the fake runner (the rest: up, project_templates, and the rows that
    // need an argument).
    expect(seen.length).toBeGreaterThan(TOOL_TABLE.length / 2);
  });
});
