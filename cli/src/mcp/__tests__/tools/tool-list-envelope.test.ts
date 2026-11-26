// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { beforeEach, describe, expect, it } from "vitest";
import { recordingTools, resetSpawnMock } from "./test-support.js";

beforeEach(() => {
  resetSpawnMock();
});

import { createFliskTools } from "../../tools.js";

describe("stack_assign, config_regenerate and resource_create return the structured envelope", () => {
  const find = (tools: ReturnType<typeof createFliskTools>, name: string) =>
    tools.find((t) => t.name === name);

  it("returns the CLI's error with code and suggestions for an unknown resource", async () => {
    const envelope = {
      schemaVersion: 1,
      data: null,
      errors: [
        {
          code: "COMMAND_FAILED",
          message: 'Resource "nope" not found',
          suggestions: ["Valid resources: api"],
        },
      ],
    };
    const { seen, tools } = recordingTools(JSON.stringify(envelope), { exitCode: 1 });
    const result = await find(tools, "stack_assign")?.handler({
      stack: "s",
      resources: ["nope"],
    });
    expect(seen[0]?.args).toEqual(["stack", "s", "--resources=nope", "--json"]);
    expect(result?.isError).toBe(true);
    expect(result?.data).toEqual(envelope);
    expect(JSON.stringify(result?.data)).not.toContain("stderr");
  });
  it("suggests moving a resource that already has a stack", async () => {
    const envelope = {
      schemaVersion: 1,
      data: null,
      errors: [
        {
          code: "COMMAND_FAILED",
          message: '"api" is already in stack "web"',
          suggestions: ["Pass --move to move it"],
        },
      ],
    };
    const { tools } = recordingTools(JSON.stringify(envelope), { exitCode: 1 });
    const result = await find(tools, "stack_assign")?.handler({
      stack: "shop",
      resources: ["api"],
    });
    expect(result?.isError).toBe(true);
    expect(result?.data).toMatchObject({ errors: [{ suggestions: ["Pass --move to move it"] }] });
  });
  it("returns the assignment in data on success", async () => {
    const envelope = {
      schemaVersion: 1,
      data: {
        stacks: [{ name: "shop", resourceCount: 1 }],
        unassigned: [],
        stack: "shop",
        assigned: [{ name: "api", configPath: "/p/services/shop/api/service.json" }],
      },
      errors: [],
    };
    const { seen, tools } = recordingTools(JSON.stringify(envelope));
    const result = await find(tools, "stack_assign")?.handler({
      stack: "shop",
      resources: ["api"],
      move: true,
    });
    expect(seen[0]?.args).toEqual(["stack", "shop", "--move", "--resources=api", "--json"]);
    expect(result).toEqual({ data: envelope, isError: false });
  });
  it("returns a COMMAND_FAILED error from outside a project", async () => {
    const envelope = {
      schemaVersion: 1,
      data: null,
      errors: [
        {
          code: "COMMAND_FAILED",
          message: "Not in a Flisk project",
          suggestions: ["Run flisk project"],
        },
      ],
    };
    const { tools } = recordingTools(JSON.stringify(envelope), { exitCode: 1 });
    const result = await find(tools, "stack_assign")?.handler({ stack: "s", resources: ["a"] });
    expect(result?.isError).toBe(true);
    expect(result?.data).toEqual(envelope);
  });
  it("returns data.changes and data.hasChanges for a config_regenerate dry run", async () => {
    const envelope = {
      schemaVersion: 1,
      data: {
        dryRun: true,
        hasChanges: true,
        changes: [
          { file: "spec.master", status: "unchanged", lineDiff: 0 },
          { file: "Tiltfile", status: "modified", lineDiff: 3 },
        ],
        staleServiceOutputs: [],
      },
      errors: [],
    };
    const { seen, tools } = recordingTools(JSON.stringify(envelope));
    const result = await find(tools, "config_regenerate")?.handler({});
    expect(seen[0]?.args).toEqual(["config", "regenerate", "--dry-run", "--json"]);
    expect(result?.isError).toBe(false);
    expect(result?.data).toMatchObject({
      data: {
        hasChanges: true,
        changes: [
          { file: "spec.master", status: "unchanged", lineDiff: 0 },
          { file: "Tiltfile", status: "modified", lineDiff: 3 },
        ],
      },
    });
  });
  it("returns the written files in the same shape for a real config_regenerate run", async () => {
    const envelope = {
      schemaVersion: 1,
      data: {
        dryRun: false,
        hasChanges: false,
        changes: [{ file: "Tiltfile", status: "unchanged", lineDiff: 0 }],
        staleServiceOutputs: [],
      },
      errors: [],
    };
    const { seen, tools } = recordingTools(JSON.stringify(envelope));
    const result = await find(tools, "config_regenerate")?.handler({ dryRun: false });
    expect(seen[0]?.args).toEqual(["config", "regenerate", "--json"]);
    expect(result).toEqual({ data: envelope, isError: false });
  });
  it("returns the created resource's report in data on success", async () => {
    const envelope = {
      schemaVersion: 1,
      data: {
        action: "created",
        name: "api",
        type: "backend",
        stack: "shop",
        port: 4100,
        path: "services/shop/api",
        framework: "hono",
        language: "bun",
        discovered: true,
      },
      errors: [],
    };
    const { seen, tools } = recordingTools(JSON.stringify(envelope));
    const result = await find(tools, "resource_create")?.handler({
      name: "api",
      type: "backend",
      stack: "shop",
    });
    expect(seen[0]?.args).toEqual(["resource", "api", "--type=backend", "--stack=shop", "--json"]);
    expect(result).toEqual({ data: envelope, isError: false });
    expect(JSON.stringify(result?.data)).not.toContain("stderr");
  });
  it("returns the CLI's error with code and suggestions when the create fails", async () => {
    const envelope = {
      schemaVersion: 1,
      data: null,
      errors: [
        {
          code: "RESOURCE_FAILED",
          message: 'Directory "services/shop/api" already exists',
          suggestions: ["Pick another name, or check resource_list first"],
        },
      ],
    };
    const { tools } = recordingTools(JSON.stringify(envelope), { exitCode: 1 });
    const result = await find(tools, "resource_create")?.handler({ name: "api" });
    expect(result?.isError).toBe(true);
    expect(result?.data).toEqual(envelope);
  });
  it("no longer describes the output as text", () => {
    const tools = createFliskTools(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    for (const name of ["stack_assign", "config_regenerate", "resource_create"]) {
      expect(find(tools, name)?.description).not.toMatch(/\btext\b/i);
    }
  });
});
