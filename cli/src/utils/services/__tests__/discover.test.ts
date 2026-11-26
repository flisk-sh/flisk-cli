// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempProject } from "../../../test-support/index.js";
import {
  clearDiscoveryResultCache,
  discoverResourcesFromRoot,
  discoverResourcesStrict,
  discoverResourcesWithProblems,
  discoverServiceManifestPaths,
} from "../discover.js";
import { resetPrintedServiceWarnings } from "../warnings.js";

const manifest = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ appName: "api", appType: "backend", ...fields });

beforeEach(() => {
  resetPrintedServiceWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("discoverServiceManifestPaths", () => {
  it("finds service.json files and skips ignored directories", () => {
    const root = createTempProject({
      resources: {
        api: manifest(),
        web: manifest(),
        "node_modules/pkg": manifest(),
        ".hidden/svc": manifest(),
      },
    });

    expect(discoverServiceManifestPaths(root)).toEqual([
      join(root, "services", "api", "service.json"),
      join(root, "services", "web", "service.json"),
    ]);
  });
});

describe("discoverResourcesWithProblems", () => {
  it("returns parsed resources for valid manifests", () => {
    const root = createTempProject({
      resources: {
        api: manifest({ appName: "orders-api", stack: "shop", port: 4317 }),
      },
    });

    const { resources, problems } = discoverResourcesWithProblems(root);

    expect(problems).toEqual([]);
    expect(resources).toEqual([
      {
        name: "orders-api",
        path: join(root, "services", "api"),
        configPath: join(root, "services", "api", "service.json"),
        config: expect.objectContaining({ appName: "orders-api", appType: "backend" }),
        stack: "shop",
        port: 4317,
        type: "backend",
      },
    ]);
  });

  it("collects a problem per invalid manifest instead of throwing", () => {
    const root = createTempProject({
      resources: {
        good: manifest({ appName: "api" }),
        "broken-json": "{ not json",
        "missing-fields": { name: "x" },
      },
    });

    const { resources, problems } = discoverResourcesWithProblems(root);

    expect(resources.map((r) => r.name)).toEqual(["api"]);
    expect(problems.map((p) => p.path)).toEqual([
      join(root, "services", "broken-json", "service.json"),
      join(root, "services", "missing-fields", "service.json"),
    ]);
    expect(problems[0].reason).toContain("invalid JSON");
    expect(problems[1].reason).toContain("missing required fields");
  });

  it("serves a cached result until clearDiscoveryResultCache invalidates it", () => {
    const root = createTempProject({ resources: { api: manifest() } });

    const first = discoverResourcesWithProblems(root);
    mkdirSync(join(root, "services", "late"));
    writeFileSync(join(root, "services", "late", "service.json"), manifest());

    expect(discoverResourcesWithProblems(root).resources).toEqual(first.resources);

    clearDiscoveryResultCache(root);
    expect(discoverResourcesWithProblems(root).resources).toHaveLength(first.resources.length + 1);
  });
});

describe("discoverResourcesFromRoot", () => {
  it("returns resources and prints each skipped file once", () => {
    const root = createTempProject({
      resources: {
        good: manifest({ appName: "api" }),
        bad: "{ nope",
      },
    });

    const resources = discoverResourcesFromRoot(root);
    discoverResourcesFromRoot(root);

    expect(resources.map((r) => r.name)).toEqual(["api"]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`skipped ${join(root, "services", "bad", "service.json")}`),
    );
  });
});

describe("discoverResourcesStrict", () => {
  it("throws one error that lists every problem", () => {
    const discovered = {
      resources: [],
      problems: [
        { path: "/p/a/service.json", reason: "invalid JSON" },
        { path: "/p/b/service.json", reason: "missing required fields" },
      ],
    };

    let thrown: unknown;
    try {
      discoverResourcesStrict(discovered);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("/p/a/service.json");
    expect(message).toContain("/p/b/service.json");
  });

  it("returns the resources of a clean result", () => {
    expect(discoverResourcesStrict({ resources: [], problems: [] })).toEqual([]);
  });
});
