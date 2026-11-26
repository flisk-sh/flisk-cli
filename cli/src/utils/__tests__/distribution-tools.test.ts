// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir, makeResource } from "../../test-support/index.js";
import { isMcpResource, readToolsAndPrompts } from "../distribution/tools.js";

function writeSource(dir: string, name: string, content: string): void {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("isMcpResource", () => {
  it("is true only when the resource appType is mcp", () => {
    expect(isMcpResource(makeResource("helper", "mcp"))).toBe(true);
    expect(isMcpResource(makeResource("api", "backend"))).toBe(false);
    expect(isMcpResource(makeResource("web", "frontend"))).toBe(false);
    expect(isMcpResource({ name: "bare", path: "/bare", configPath: "/bare/service.json" })).toBe(
      false,
    );
  });
});

describe("readToolsAndPrompts", () => {
  it("finds tools registered by name string and by config object", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "server.ts",
      [
        'server.registerTool("plan_app", {});',
        'server.registerTool({ name: "check_site", title: "x" }, handler);',
        "mcpServer.registerTool(`templated_tool`, {});",
      ].join("\n"),
    );
    expect(readToolsAndPrompts(dir).tools).toEqual(["check_site", "plan_app", "templated_tool"]);
  });

  it("finds tools on server, mcp, mcpServer and mcp_server objects", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "a.ts",
      [
        'server.tool("via_server", {});',
        'mcp.tool("via_mcp", {});',
        'mcpServer.tool("via_mcpServer", {});',
        'mcp_server.tool("via_mcp_server", {});',
      ].join("\n"),
    );
    expect(readToolsAndPrompts(dir).tools).toEqual([
      "via_mcp",
      "via_mcp_server",
      "via_mcpServer",
      "via_server",
    ]);
  });

  it("ignores .tool calls on objects that are not MCP server handles", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "a.ts",
      [
        'otherobj.tool("ignored_other");',
        'foo.tool("ignored_foo");',
        'client.tool("ignored_client");',
        'db.tool("ignored_db");',
        'myserver.tool("ignored_myserver");',
        'tool("ignored_bare");',
        'mcp.unregisterTool("ignored_unregister");',
      ].join("\n"),
    );
    expect(readToolsAndPrompts(dir)).toEqual({ tools: [], prompts: [] });
  });

  it("finds Python tool and prompt decorators", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "server.py",
      [
        "@mcp.tool",
        "def bare_tool():",
        "    pass",
        "",
        "@mcp.tool()",
        "async def called_tool():",
        "    pass",
        "",
        "@mcp.prompt",
        "def bare_prompt():",
        "    pass",
        "",
        "@mcp.prompt()",
        "async def called_prompt():",
        "    pass",
      ].join("\n"),
    );
    expect(readToolsAndPrompts(dir)).toEqual({
      tools: ["bare_tool", "called_tool"],
      prompts: ["bare_prompt", "called_prompt"],
    });
  });

  it("finds registerPrompt names and .prompt registrations", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "prompts.ts",
      [
        'server.registerPrompt("welcome_prompt", {});',
        'mcp.registerPrompt({ name: "farewell_prompt" });',
        'server.prompt("hint_prompt", {});',
        'otherobj.prompt("ignored_prompt");',
      ].join("\n"),
    );
    expect(readToolsAndPrompts(dir).prompts).toEqual([
      "farewell_prompt",
      "hint_prompt",
      "welcome_prompt",
    ]);
  });

  it("returns sorted unique names across files", () => {
    const dir = createTempDir();
    writeSource(
      dir,
      "a.ts",
      [
        'registerTool("zeta");',
        'registerTool("alpha");',
        'registerTool("zeta");',
        'registerPrompt("z_prompt");',
        'registerPrompt("a_prompt");',
        'registerPrompt("z_prompt");',
      ].join("\n"),
    );
    writeSource(dir, "b.js", 'mcp.tool("mid");');
    expect(readToolsAndPrompts(dir)).toEqual({
      tools: ["alpha", "mid", "zeta"],
      prompts: ["a_prompt", "z_prompt"],
    });
  });

  it("excludes test files but keeps files that merely contain test in the name", () => {
    const dir = createTempDir();
    writeSource(dir, "real.ts", 'registerTool("real_tool");');
    writeSource(dir, "real.test.ts", 'registerTool("test_tool");');
    writeSource(dir, "unit.test.js", 'registerTool("unit_test_tool");');
    writeSource(dir, "contest.ts", 'registerTool("contest_tool");');
    expect(readToolsAndPrompts(dir).tools).toEqual(["contest_tool", "real_tool"]);
  });

  it("excludes skipped directories at any depth", () => {
    const dir = createTempDir();
    for (const skip of [
      "node_modules",
      "dist",
      ".git",
      ".flisk",
      "build",
      "__pycache__",
      ".venv",
    ]) {
      writeSource(dir, `${skip}/inner.ts`, 'registerTool("skip_tool");');
    }
    writeSource(dir, "src/node_modules/dep.ts", 'registerTool("nested_skip");');
    writeSource(dir, "src/lib/util.ts", 'registerTool("util_tool");');
    writeSource(dir, "src/ok.ts", 'registerTool("ok_tool");');
    expect(readToolsAndPrompts(dir).tools).toEqual(["ok_tool", "util_tool"]);
  });

  it("stops scanning past the depth limit", () => {
    const dir = createTempDir();
    writeSource(dir, "a/b/c/d/e/f/ok.ts", 'registerTool("ok_deep");');
    writeSource(dir, "a/b/c/d/e/f/g/deep.ts", 'registerTool("too_deep");');
    expect(readToolsAndPrompts(dir).tools).toEqual(["ok_deep"]);
  });

  it("ignores files without a source extension", () => {
    const dir = createTempDir();
    writeSource(dir, "notes.md", 'registerTool("md_tool");');
    writeSource(dir, "data.json", 'registerTool("json_tool");');
    writeSource(dir, "component.tsx", 'registerTool("tsx_tool");');
    writeSource(dir, "real.ts", 'registerTool("ts_tool");');
    expect(readToolsAndPrompts(dir).tools).toEqual(["ts_tool"]);
  });

  it("returns empty lists for an empty or missing directory", () => {
    const dir = createTempDir();
    expect(readToolsAndPrompts(dir)).toEqual({ tools: [], prompts: [] });
    expect(readToolsAndPrompts(path.join(dir, "missing"))).toEqual({
      tools: [],
      prompts: [],
    });
  });
});
