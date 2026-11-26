// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join as pathJoin } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectFixture, fakeUp, recordingTools, resetSpawnMock } from "./test-support.js";

beforeEach(() => {
  resetSpawnMock();
});

const fixture = createProjectFixture();

import { listProjectTemplates, PROJECT_TEMPLATES } from "../../../utils/project-templates.js";

import { createFliskTools } from "../../tools.js";

describe("tool list", () => {
  it("exposes tools with object schemas and no streaming logs", () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    expect(tools.map((t) => t.name)).toEqual([
      "doctor",
      "up",
      "down",
      "status",
      "wait",
      "logs",
      "resource_list",
      "resource_restart",
      "resource_run",
      "agent_list",
      "agent_sessions",
      "stack_list",
      "project_info",
      "project_templates",
      "network_list",
      "config_verify",
      "config_explain",
      "runtime_check",
      "config_regenerate",
      "resource_create",
      "tool_add",
      "stack_assign",
      "project_init",
      "project_eject",
      "project_import",
    ]);
    for (const t of tools)
      expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    // project_templates reads the CLI's own catalog, not a project, so it takes no projectPath.
    for (const t of tools.filter((tool) => tool.name !== "project_templates"))
      expect(t.inputSchema.properties).toHaveProperty("projectPath");
    expect(JSON.stringify(tools.find((t) => t.name === "logs")?.inputSchema)).not.toContain(
      "follow",
    );
  });

  it("returns the template catalog from project_templates without running the CLI", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const tool = createFliskTools(run).find((t) => t.name === "project_templates");
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    const result = await tool?.handler({});
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { templates: listProjectTemplates() }, isError: false });
    const data = result?.data as { templates: { key: string }[] } | undefined;
    const keys = (data?.templates ?? []).map((t) => t.key);
    expect(keys).toEqual(Object.keys(PROJECT_TEMPLATES));
    expect(keys).toEqual(expect.arrayContaining(["launch", "portal", "fullstack"]));
  });

  it("routes a tool to its command and project directory", async () => {
    const seen: { args: string[]; cwd?: string }[] = [];
    const tools = createFliskTools(async (args, options) => {
      seen.push({ args, cwd: options?.cwd });
      return { exitCode: 0, stdout: '{"schemaVersion":1,"data":[],"errors":[]}', stderr: "" };
    });
    await tools.find((t) => t.name === "doctor")?.handler({ projectPath: fixture.projectDir });
    await tools.find((t) => t.name === "resource_list")?.handler({ stack: "store" });
    await tools.find((t) => t.name === "status")?.handler({});
    await tools.find((t) => t.name === "down")?.handler({ dryRun: true });
    await tools.find((t) => t.name === "resource_restart")?.handler({ resource: "api" });
    await tools
      .find((t) => t.name === "resource_run")
      ?.handler({ resource: "api", command: ["printenv", "DATABASE_URL"], confirm: true });
    await tools.find((t) => t.name === "agent_list")?.handler({ stack: "shop" });
    await tools
      .find((t) => t.name === "agent_sessions")
      ?.handler({ resource: "bot", sessionId: "sess-1" });
    await tools.find((t) => t.name === "agent_sessions")?.handler({ resource: "bot" });
    expect(seen).toEqual([
      { args: ["doctor", "--json"], cwd: fixture.projectDir },
      { args: ["resources", "--json", "--stack=store"], cwd: undefined },
      { args: ["status", "--json"], cwd: undefined },
      { args: ["down", "--json", "--dry-run"], cwd: undefined },
      { args: ["restart", "api", "--json", "--wait=60"], cwd: undefined },
      { args: ["run", "api", "--json", "--", "printenv", "DATABASE_URL"], cwd: undefined },
      { args: ["resources", "--type=agent", "--json", "--stack=shop"], cwd: undefined },
      { args: ["agent", "sessions", "bot", "--session-id=sess-1", "--json"], cwd: undefined },
      { args: ["agent", "sessions", "bot", "--json"], cwd: undefined },
    ]);
    await expect(
      tools.find((t) => t.name === "doctor")?.handler({ projectPath: "relative" }),
    ).rejects.toThrow("projectPath must be an absolute path");
    await expect(tools.find((t) => t.name === "resource_restart")?.handler({})).rejects.toThrow(
      "resource is required",
    );
    await expect(tools.find((t) => t.name === "agent_sessions")?.handler({})).rejects.toThrow(
      "resource is required",
    );
    expect(tools.find((t) => t.name === "agent_sessions")?.inputSchema).toMatchObject({
      required: ["resource"],
    });
  });

  it("forwards problemsOnly and noPing flags to doctor command", async () => {
    const seen: { args: string[]; cwd?: string }[] = [];
    const tools = createFliskTools(async (args, options) => {
      seen.push({ args, cwd: options?.cwd });
      return { exitCode: 0, stdout: '{"schemaVersion":1,"data":[],"errors":[]}', stderr: "" };
    });
    await tools
      .find((t) => t.name === "doctor")
      ?.handler({ projectPath: fixture.projectDir, problemsOnly: true, noPing: true });
    expect(seen).toEqual([
      { args: ["doctor", "--json", "--problems-only", "--no-ping"], cwd: fixture.projectDir },
    ]);
  });

  it("documents target and transitive sidecarOf scope on resource_restart", () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const desc = tools.find((t) => t.name === "resource_restart")?.description ?? "";
    expect(desc).toContain("sidecarOf");
    expect(desc).not.toContain("the other resources are not touched");
  });

  it("forwards rebuild to flisk restart --rebuild for resource_restart", async () => {
    const seen: string[][] = [];
    const tools = createFliskTools(async (args) => {
      seen.push(args);
      return { exitCode: 0, stdout: '{"schemaVersion":1,"data":{},"errors":[]}', stderr: "" };
    });
    await tools
      .find((t) => t.name === "resource_restart")
      ?.handler({ resource: "api", rebuild: true });
    await tools
      .find((t) => t.name === "resource_restart")
      ?.handler({ resource: "api", rebuild: false });
    await tools.find((t) => t.name === "resource_restart")?.handler({ resource: "api" });
    expect(seen).toEqual([
      ["restart", "api", "--json", "--wait=60", "--rebuild"],
      ["restart", "api", "--json", "--wait=60"],
      ["restart", "api", "--json", "--wait=60"],
    ]);
    await expect(
      tools
        .find((t) => t.name === "resource_restart")
        ?.handler({ resource: "api", rebuild: "yes" }),
    ).rejects.toThrow("rebuild must be a boolean");
  });

  it("extends the CLI subprocess timeout for resource_restart beyond stopGracePeriod", async () => {
    const tempProject = mkdtempSync(pathJoin(tmpdir(), "flisk-mcp-restart-timeout-"));
    try {
      mkdirSync(pathJoin(tempProject, ".flisk"), { recursive: true });
      mkdirSync(pathJoin(tempProject, "services", "worker"), { recursive: true });
      writeFileSync(
        pathJoin(tempProject, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "timeout-test" } }),
      );
      writeFileSync(
        pathJoin(tempProject, "services", "worker", "service.json"),
        JSON.stringify({
          appName: "worker",
          appType: "worker",
          stack: "main",
          container: { stopGracePeriod: "3m" },
        }),
      );
      const { seen, tools } = recordingTools('{"schemaVersion":1,"data":{},"errors":[]}');
      await tools
        .find((t) => t.name === "resource_restart")
        ?.handler({ projectPath: tempProject, resource: "worker" });
      expect(seen).toEqual([
        {
          args: ["restart", "worker", "--json", "--wait=60"],
          cwd: tempProject,
          timeoutMs: 310_000,
        },
      ]);
    } finally {
      rmSync(tempProject, { recursive: true, force: true });
    }
  });

  it("accounts for sequential sidecarOf restarts in the resource_restart MCP timeout", async () => {
    const tempProject = mkdtempSync(pathJoin(tmpdir(), "flisk-mcp-sidecar-timeout-"));
    try {
      mkdirSync(pathJoin(tempProject, ".flisk"), { recursive: true });
      mkdirSync(pathJoin(tempProject, "services", "tubehaus"), { recursive: true });
      mkdirSync(pathJoin(tempProject, "services", "bgutil"), { recursive: true });
      mkdirSync(pathJoin(tempProject, "services", "bgutil-helper"), { recursive: true });
      writeFileSync(
        pathJoin(tempProject, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "sidecar-timeout" } }),
      );
      writeFileSync(
        pathJoin(tempProject, "services", "tubehaus", "service.json"),
        JSON.stringify({ appName: "tubehaus", appType: "bring-your-own", stack: "tube" }),
      );
      writeFileSync(
        pathJoin(tempProject, "services", "bgutil", "service.json"),
        JSON.stringify({
          appName: "bgutil",
          appType: "bring-your-own",
          stack: "tube",
          sidecarOf: "tubehaus",
        }),
      );
      writeFileSync(
        pathJoin(tempProject, "services", "bgutil-helper", "service.json"),
        JSON.stringify({
          appName: "bgutil-helper",
          appType: "bring-your-own",
          stack: "tube",
          sidecarOf: "bgutil",
          container: { stopGracePeriod: "2m" },
        }),
      );
      const { seen, tools } = recordingTools('{"schemaVersion":1,"data":{},"errors":[]}');
      await tools
        .find((t) => t.name === "resource_restart")
        ?.handler({ projectPath: tempProject, resource: "tubehaus" });
      expect(seen).toEqual([
        {
          args: ["restart", "tubehaus", "--json", "--wait=60"],
          cwd: tempProject,
          timeoutMs: 490_000,
        },
      ]);
    } finally {
      rmSync(tempProject, { recursive: true, force: true });
    }
  });

  it("rejects invalid tool arguments before running the CLI", async () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    await expect(
      tools.find((t) => t.name === "resource_restart")?.handler({ resource: "-x" }),
    ).rejects.toThrow("resource must be a name");
    await expect(
      tools.find((t) => t.name === "agent_list")?.handler({ stack: "a b" }),
    ).rejects.toThrow("stack must be a name");
    await expect(
      tools.find((t) => t.name === "doctor")?.handler({ noPing: "yes" }),
    ).rejects.toThrow("noPing must be a boolean");
    await expect(
      tools.find((t) => t.name === "status")?.handler({ projectPath: 42 }),
    ).rejects.toThrow("projectPath must be an absolute path");
  });

  it("runs the up handler through the injected dependencies", async () => {
    const { deps } = fakeUp({ logs: ['{"schemaVersion":1,"data":{"ok":true},"errors":[]}'] });
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }), deps);
    const result = await tools.find((t) => t.name === "up")?.handler({ waitSeconds: 0 });
    expect(result?.isError).toBe(false);
  });

  it("routes the read-only tools to their --json commands and project directory", async () => {
    const { seen, tools } = recordingTools('{"schemaVersion":1,"data":{},"errors":[]}');
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    await call("stack_list", { projectPath: fixture.projectDir });
    await call("stack_list", { services: true, verbose: true });
    await call("project_info", {});
    await call("network_list", { stack: "shop" });
    await call("network_list", {});
    await call("config_verify", { projectPath: fixture.projectDir });
    await call("config_explain", { file: ".flisk/.flisk-out/Tiltfile" });
    await call("config_explain", { file: "/work/erp/services/shop/api/service.json" });
    await call("runtime_check", {});
    expect(seen).toEqual([
      { args: ["stacks", "--json"], cwd: fixture.projectDir },
      { args: ["stacks", "--json", "--services", "--verbose"], cwd: undefined },
      { args: ["projects", "--json"], cwd: undefined },
      { args: ["networks", "--json", "--stack=shop"], cwd: undefined },
      { args: ["networks", "--json"], cwd: undefined },
      { args: ["config", "verify", "--json"], cwd: fixture.projectDir },
      { args: ["config", "explain", ".flisk/.flisk-out/Tiltfile", "--json"], cwd: undefined },
      {
        args: ["config", "explain", "/work/erp/services/shop/api/service.json", "--json"],
        cwd: undefined,
      },
      { args: ["runtime", "--check-assets", "--json"], cwd: undefined },
    ]);
    expect(tools.find((t) => t.name === "config_explain")?.inputSchema).toMatchObject({
      required: ["file"],
    });
  });

  it("passes config_verify diffFiles as repeatable --diff options", async () => {
    const { seen, tools } = recordingTools(
      '{"schemaVersion":1,"data":{"valid":false,"errors":[],"diffs":[]},"errors":[]}',
    );
    const tool = tools.find((t) => t.name === "config_verify");

    await tool?.handler({ diffFiles: [".flisk/.flisk-out/Tiltfile", "spec.master"] });

    expect(seen).toEqual([
      {
        args: [
          "config",
          "verify",
          "--json",
          "--diff=.flisk/.flisk-out/Tiltfile",
          "--diff=spec.master",
        ],
        cwd: undefined,
      },
    ]);
    await expect(tool?.handler({ diffFiles: "Tiltfile" })).rejects.toThrow(
      "diffFiles must be an array of paths",
    );
    await expect(tool?.handler({ diffFiles: ["-bad"] })).rejects.toThrow(
      'diffFiles must be a non-empty path that does not start with "-"',
    );
  });

  it("gives config_verify a short text summary, leaving the full report in structured data", async () => {
    const bigDiff = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");
    const file = ".flisk/.flisk-out/Tiltfile";
    const report = {
      valid: false,
      errors: [`Missing file: ${file} (run 'flisk config regenerate')`],
      diffs: [{ file, state: "missing", linesAdded: 500, linesRemoved: 0, diff: bigDiff }],
      diffLineLimit: 200,
      state: "generated",
    };
    const { tools } = recordingTools(
      JSON.stringify({ schemaVersion: 1, data: report, errors: [] }),
    );

    const result = await tools.find((t) => t.name === "config_verify")?.handler({});

    expect(result?.text).toContain("config verify:");
    expect(result?.text).toContain("1 missing");
    expect(result?.text).toContain(`Missing file: ${file}`);
    expect(result?.text?.length).toBeLessThan(500);
    expect(result?.text).not.toContain("+line 499");
    // The JSON is sent once as structuredContent, with every path and the diff still present.
    expect(result?.data).toMatchObject({ data: report });
  });

  it("rejects invalid read-only tool arguments before running the CLI", async () => {
    const { seen, tools } = recordingTools("");
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((t) => t.name === name)?.handler(args);
    await expect(call("stack_list", { services: "yes" })).rejects.toThrow(
      "services must be a boolean",
    );
    await expect(call("stack_list", { verbose: 1 })).rejects.toThrow("verbose must be a boolean");
    await expect(call("network_list", { stack: "-s" })).rejects.toThrow("stack must be a name");
    await expect(call("config_explain", {})).rejects.toThrow("file is required");
    await expect(call("config_explain", { file: "--json" })).rejects.toThrow(
      'file must be a non-empty path that does not start with "-"',
    );
    await expect(call("config_explain", { file: 42 })).rejects.toThrow("file must be a non-empty");
    await expect(call("project_info", { projectPath: "relative" })).rejects.toThrow(
      "projectPath must be an absolute path",
    );
    expect(seen).toEqual([]);
  });
});
