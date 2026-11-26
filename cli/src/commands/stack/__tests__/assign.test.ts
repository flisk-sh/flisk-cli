// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempProject } from "../../../test-support/index.js";
import type { DiscoveredResource } from "../../../types/index.js";
import { clearDiscoveryCache } from "../../../utils/discovery-context.js";
import { FliskError } from "../../../utils/errors.js";
import { parseStackResourceConfig, writeStackAssignments } from "../assign.js";

const SERVICE = { schemaVersion: 1, appType: "backend", runtime: "bun", port: 4100 };

/** A discovered resource whose manifest lives at `<root>/services/<dir>/service.json`. */
function discovered(root: string, dir: string, name: string, stack?: string): DiscoveredResource {
  return {
    name,
    path: join(root, "services", dir),
    configPath: join(root, "services", dir, "service.json"),
    stack,
  };
}

function readManifest(configPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
}

async function neverRegenerate(): Promise<never> {
  throw new Error("regenerate must not run without a relocation");
}

describe("parseStackResourceConfig", () => {
  it("parses a service.json and reports the path on malformed JSON", () => {
    expect(parseStackResourceConfig('{"appName":"api","stack":"core"}', "service.json")).toEqual({
      appName: "api",
      stack: "core",
    });
    expect(() => parseStackResourceConfig("{", "/tmp/api/service.json")).toThrow(FliskError);
    expect(() => parseStackResourceConfig("{", "/tmp/api/service.json")).toThrow(
      "/tmp/api/service.json",
    );
  });
});

describe("writeStackAssignments", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDiscoveryCache();
  });

  it("writes the stack field onto each selected service.json", async () => {
    const root = createTempProject({
      projectJson: {},
      resources: { "main/api": SERVICE, "main/web": { ...SERVICE, appType: "frontend" } },
    });
    const api = discovered(root, "main/api", "api");
    const web = discovered(root, "main/web", "web");

    const result = await writeStackAssignments({
      selectedPaths: [api.configPath, web.configPath],
      relocations: new Map(),
      resources: [api, web],
      projectRoot: root,
      targetStack: "core",
      regenerate: neverRegenerate,
    });

    expect(readManifest(api.configPath).stack).toBe("core");
    expect(readManifest(web.configPath).stack).toBe("core");
    expect(result.assigned).toEqual([
      { name: "api", configPath: api.configPath },
      { name: "web", configPath: web.configPath },
    ]);
    expect(result.changedPaths).toEqual(new Set([api.configPath, web.configPath]));
  });

  it("removes the stack field and keeps the other settings", async () => {
    const root = createTempProject({
      projectJson: {},
      resources: { "legacy/api": { ...SERVICE, stack: "legacy" } },
    });
    const api = discovered(root, "legacy/api", "api", "legacy");

    const result = await writeStackAssignments({
      selectedPaths: [api.configPath],
      relocations: new Map(),
      resources: [api],
      projectRoot: root,
      targetStack: null,
      remove: true,
      regenerate: neverRegenerate,
    });

    const manifest = readManifest(api.configPath);
    expect(manifest).not.toHaveProperty("stack");
    expect(manifest.appType).toBe("backend");
    expect(manifest.port).toBe(4100);
    expect(result.assigned).toEqual([{ name: "api", configPath: api.configPath }]);
  });

  it("relocates the folder on a move, then regenerates", async () => {
    const root = createTempProject({
      projectJson: {},
      resources: { "legacy/api": { ...SERVICE, stack: "legacy" } },
    });
    const api = discovered(root, "legacy/api", "api", "legacy");
    const movedTo = join(root, "services", "backend", "api", "service.json");
    const regenerate = vi.fn(async (_root: string) => {});

    const result = await writeStackAssignments({
      selectedPaths: [api.configPath],
      relocations: new Map([[api.configPath, movedTo]]),
      resources: [api],
      projectRoot: root,
      targetStack: "backend",
      regenerate,
    });

    expect(regenerate).toHaveBeenCalledWith(root);
    expect(existsSync(api.configPath)).toBe(false);
    expect(readManifest(movedTo).stack).toBe("backend");
    expect(result.assigned).toEqual([{ name: "api", configPath: movedTo }]);
    expect(result.changedPaths).toEqual(new Set([api.configPath, movedTo]));
  });

  it("restores the manifest content when the move's rename fails", async () => {
    const root = createTempProject({
      projectJson: {},
      resources: { "legacy/api": { ...SERVICE, stack: "legacy" } },
      files: { "services/backend/api/blocker.txt": "occupied" },
    });
    const api = discovered(root, "legacy/api", "api", "legacy");
    const before = readFileSync(api.configPath, "utf8");
    const movedTo = join(root, "services", "backend", "api", "service.json");

    // Renaming services/legacy/api over the non-empty services/backend/api fails
    // with ENOTEMPTY/EEXIST, so the write-back must put the original manifest back.
    await expect(
      writeStackAssignments({
        selectedPaths: [api.configPath],
        relocations: new Map([[api.configPath, movedTo]]),
        resources: [api],
        projectRoot: root,
        targetStack: "backend",
        regenerate: neverRegenerate,
      }),
    ).rejects.toThrow();

    expect(readFileSync(api.configPath, "utf8")).toBe(before);
  });

  it("refuses a malformed service.json and names its path", async () => {
    const root = createTempProject({
      projectJson: {},
      resources: { "main/broken": "{" },
    });
    const broken = discovered(root, "main/broken", "broken");

    let caught: unknown;
    try {
      await writeStackAssignments({
        selectedPaths: [broken.configPath],
        relocations: new Map(),
        resources: [broken],
        projectRoot: root,
        targetStack: "core",
        regenerate: neverRegenerate,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toContain("Could not parse service.json");
    expect((caught as FliskError).message).toContain("main/broken");
  });
});
