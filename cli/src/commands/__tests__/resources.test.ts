// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFliskTools } from "../../mcp/tools.js";
import { captureExit, parseEnvelope, runFlisk } from "../../test-support/index.js";
import { isResourceCreateType } from "../../types/index.js";
import { VALID_RESOURCE_TYPES } from "../../utils/constants.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import { resourcesCommand } from "../resources.js";

const originalCwd = process.cwd();

describe("resources command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "flisk-resources-test-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    clearDiscoveryCache();
    vi.restoreAllMocks();
  });

  function setupProject(
    resources: Array<{ name: string; type: string; stack?: string; port?: number }>,
    root = tempDir,
  ) {
    mkdirSync(join(root, ".flisk"), { recursive: true });
    writeFileSync(
      join(root, ".flisk", "project.json"),
      JSON.stringify({
        version: "1.0.0",
        project: { name: "test-proj", version: "1.0.0" },
        phases: {
          alpha: { name: "alpha", description: "", enabledStacks: ["shop", "core"] },
        },
        discovery: { paths: ["services/**"] },
      }),
    );

    for (const r of resources) {
      const resourceDir = r.stack
        ? join(root, "services", r.stack, r.name)
        : join(root, "services", r.name);
      mkdirSync(resourceDir, { recursive: true });
      writeFileSync(
        join(resourceDir, "service.json"),
        JSON.stringify({
          name: r.name,
          appName: r.name,
          type: r.type,
          appType: r.type,
          runtime: "bun",
          stack: r.stack,
          port: r.port,
        }),
      );
    }
  }

  /** Runs `flisk resources` in-process with --json and returns the parsed envelope. */
  async function runResourcesJson(args: string[]) {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await resourcesCommand.parseAsync(["node", "flisk", ...args, "--json"], { from: "node" });
    return parseEnvelope(logSpy.mock.calls.map((c) => c.join(" ")).join("\n"));
  }

  /** Runs `flisk resources` in-process and returns what it printed. */
  async function runResourcesText(args: string[]): Promise<string> {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await resourcesCommand.parseAsync(["node", "flisk", ...args], { from: "node" });
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  /** Runs `flisk resources` in-process and expects it to exit 1 with an error. */
  async function expectResourcesExit(args: string[]): Promise<void> {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();
    await expect(
      resourcesCommand.parseAsync(["node", "flisk", ...args], { from: "node" }),
    ).rejects.toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  }

  it("rejects when not in a Flisk project", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { exit } = captureExit();

    await expect(
      resourcesCommand.parseAsync(["node", "flisk"], { from: "node" }),
    ).rejects.toThrow();

    expect(exit).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("emits machine error when invoked with --json outside project", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    await expect(
      resourcesCommand.parseAsync(["node", "flisk", "--json"], { from: "node" }),
    ).rejects.toThrow();

    expect(exit).toHaveBeenCalled();
    const firstCall = logSpy.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const envelope = JSON.parse(String(firstCall));
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.errors[0]?.code).toBe("NOT_IN_PROJECT");
    expect(envelope.errors[0]?.message).toContain(
      "Could not find project root (no .flisk/project.json found)",
    );
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("rejects invalid resource type with error", async () => {
    setupProject([]);
    await expectResourcesExit(["--type", "invalid-type"]);
  });

  it.each(["queue", "inference"])("suggests the stored resource type for --type %s", (type) => {
    setupProject([]);
    const result = runFlisk(["resources", "--type", type], { cwd: tempDir });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Invalid resource type "${type}"`);
    expect(result.stderr).toContain("saved as bring-your-own resources");
    expect(result.stderr).toContain("flisk resources --type bring-your-own");
  });

  it.each(["queue", "inference"])(
    "includes the filter hint for --type %s in JSON errors",
    (type) => {
      setupProject([]);
      const result = runFlisk(["resources", "--type", type, "--json"], { cwd: tempDir });

      expect(result.status).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.errors[0]).toMatchObject({
        message: `Invalid resource type "${type}"`,
        suggestions: [expect.stringContaining("flisk resources --type bring-your-own")],
      });
    },
  );

  it("exits when requested stack does not exist", async () => {
    setupProject([{ name: "api", type: "backend", stack: "shop", port: 4000 }]);
    await expectResourcesExit(["--stack", "nonexistent"]);
  });

  it("emits JSON machine error when requested stack does not exist with --json", async () => {
    setupProject([{ name: "api", type: "backend", stack: "shop", port: 4000 }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    await expect(
      resourcesCommand.parseAsync(["node", "flisk", "--stack", "nonexistent", "--json"], {
        from: "node",
      }),
    ).rejects.toThrow();

    expect(exit).toHaveBeenCalled();
    const firstCall = logSpy.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const envelope = JSON.parse(String(firstCall));
    expect(envelope.errors[0]?.message).toContain('Stack "nonexistent" not found');
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("returns empty resources array in JSON envelope for empty project", async () => {
    setupProject([]);
    const envelope = await runResourcesJson([]);
    expect(envelope.data.resources).toEqual([]);
  });

  it("lists all resources across stacks in JSON format", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "web", type: "frontend", stack: "shop", port: 3000 },
      { name: "worker", type: "worker", stack: "core", port: 6001 },
      { name: "orphan", type: "backend", port: 4002 },
    ]);
    const envelope = await runResourcesJson([]);
    expect(envelope.data.resources).toHaveLength(4);
    const names = envelope.data.resources.map((r: { name: string }) => r.name).sort();
    expect(names).toEqual(["orders", "orphan", "web", "worker"]);
  });

  it("emits byte-identical JSON for the same project under two different parent folders", () => {
    const resources = [
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "web", type: "frontend", stack: "shop", port: 3000 },
      { name: "orphan", type: "backend", port: 4002 },
    ];
    const firstRoot = join(tempDir, "first-parent", "same-project");
    const secondRoot = join(tempDir, "second-parent-with-a-different-name", "same-project");
    setupProject(resources, firstRoot);
    setupProject(resources, secondRoot);

    const first = runFlisk(["resources", "--json"], { cwd: firstRoot });
    const second = runFlisk(["resources", "--json"], { cwd: secondRoot });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).not.toContain(firstRoot);
    expect(first.stdout).not.toContain(secondRoot);
  });

  it("reports a relative folder that exists and keeps the manifest in its own field", () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "orphan", type: "backend", port: 4002 },
    ]);

    const result = runFlisk(["resources", "--json"], { cwd: tempDir });
    expect(result.status).toBe(0);
    const data = parseEnvelope(result.stdout).data;
    expect(data.resources).toHaveLength(2);
    for (const resource of data.resources as Array<{ path: string; manifest: string }>) {
      expect(isAbsolute(resource.path)).toBe(false);
      expect(resource.path).not.toMatch(/service\.json$/);
      expect(statSync(join(tempDir, resource.path)).isDirectory()).toBe(true);
      expect(resource.manifest).toBe(`${resource.path}/service.json`);
      expect(statSync(join(tempDir, resource.manifest)).isFile()).toBe(true);
    }
  });

  it("returns the same JSON envelope from the resource_list MCP tool as from the CLI", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const cli = runFlisk(["resources", "--json"], { cwd: tempDir });
    expect(cli.status).toBe(0);

    const tool = createFliskTools(async (args, options) => {
      const result = runFlisk(args, { cwd: options?.cwd ?? tempDir });
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    }).find((candidate) => candidate.name === "resource_list");
    const result = await tool?.handler({ projectPath: tempDir });

    expect(result?.isError).toBe(false);
    expect(result?.data).toEqual(JSON.parse(cli.stdout));
  });

  it("filters resources by type in JSON output", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "web", type: "frontend", stack: "shop", port: 3000 },
    ]);
    const envelope = await runResourcesJson(["--type", "frontend"]);
    expect(envelope.data.resources).toHaveLength(1);
    expect(envelope.data.resources[0].name).toBe("web");
  });

  it("filters resources by stack in JSON output", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "core-api", type: "backend", stack: "core", port: 4002 },
    ]);
    const envelope = await runResourcesJson(["--stack", "shop"]);
    expect(envelope.data.resources).toHaveLength(1);
    expect(envelope.data.resources[0].name).toBe("orders");
  });

  it("filters unassigned resources with --no-stack in JSON output", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "standalone", type: "backend", port: 4005 },
    ]);
    const envelope = await runResourcesJson(["--no-stack"]);
    expect(envelope.data.resources).toHaveLength(1);
    expect(envelope.data.resources[0].name).toBe("standalone");
  });

  it("formats human-readable output with --ports and --verbose", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--ports", "--verbose"]);
    expect(output).toContain("orders");
    expect(output).toContain("Port: 4001");
    expect(output).toContain("Type: backend");
    expect(output).toContain("Path:");
  });

  it("shows the port with --verbose alone (#4423)", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--verbose"]);
    expect(output).toContain("orders");
    expect(output).toContain("Type: backend");
    expect(output).toContain("Port: 4001");
    expect(output).toContain("Path:");
  });

  it("warns about unassigned resources when listing without filters", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "orphan", type: "backend", port: 4002 },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await resourcesCommand.parseAsync(["node", "flisk"], { from: "node" });

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("1 resource not assigned to any stack");
    expect(output).toContain("resources --no-stack");
    logSpy.mockRestore();
  });

  it("displays empty state when project has no resources", async () => {
    setupProject([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await resourcesCommand.parseAsync(["node", "flisk"], { from: "node" });

    const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No resources found.");
    expect(output).toContain("flisk resource <name>");
    logSpy.mockRestore();
  });

  it("displays empty state when filtering by type yields no matches", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--type", "worker"]);
    expect(output).toContain('No resources found with type "worker".');
    expect(output).toContain("flisk resource <name>");
  });

  it("does not suggest creating a library with --type in the empty state", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--type", "library"]);
    expect(output).toContain('No resources found with type "library".');
    expect(output).toContain("flisk resource <name>");
    expect(output).not.toContain("--type library");
  });

  it("keeps the --type creation hint for a creatable type in the empty state", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--type", "worker"]);
    expect(output).toContain("flisk resource <name> --type worker");
  });

  it("displays empty state when filtering by stack and type yields no matches", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--stack", "shop", "--type", "worker"]);
    expect(output).toContain('No services found in stack "shop" with type "worker".');
    expect(output).toContain("flisk resource <name> --stack <stack-name>");
  });

  it("reports all resources are assigned to a stack when --no-stack has no matches", async () => {
    setupProject([{ name: "orders", type: "backend", stack: "shop", port: 4001 }]);
    const output = await runResourcesText(["--no-stack"]);
    expect(output).toContain("All resources are assigned to a stack!");
  });

  it("displays (not assigned) for unassigned resources with --verbose", async () => {
    setupProject([{ name: "orphan", type: "backend", port: 4002 }]);
    const output = await runResourcesText(["--verbose"]);
    expect(output).toContain("orphan");
    expect(output).toContain("Stack: (not assigned)");
  });

  it("filters resources by type in human-readable output", async () => {
    setupProject([
      { name: "orders", type: "backend", stack: "shop", port: 4001 },
      { name: "web", type: "frontend", stack: "shop", port: 3000 },
    ]);
    const output = await runResourcesText(["--type", "frontend"]);
    expect(output).toContain("web");
    expect(output).not.toContain("orders");
  });
});

describe("resource type lists", () => {
  it("only library and migrator are filterable but not creatable", () => {
    const filterOnly = VALID_RESOURCE_TYPES.filter((type) => !isResourceCreateType(type));
    expect([...filterOnly].sort()).toEqual(["library", "migrator"]);
  });

  it("accepts every creatable type, plus sdk", () => {
    expect(isResourceCreateType("backend")).toBe(true);
    expect(isResourceCreateType("inference")).toBe(true);
    expect(isResourceCreateType("sdk")).toBe(true);
    expect(isResourceCreateType("library")).toBe(false);
    expect(isResourceCreateType("migrator")).toBe(false);
  });
});
