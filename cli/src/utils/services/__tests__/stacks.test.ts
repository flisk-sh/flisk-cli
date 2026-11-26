// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { makeResource } from "../../../test-support/index.js";
import type { DiscoveredResource } from "../../../types/index.js";
import {
  discoverStackNames,
  discoverStacks,
  getAllStacks,
  getResourcesForStack,
  stackExists,
} from "../stacks.js";

function stacked(name: string, stack?: string): DiscoveredResource {
  return { ...makeResource(name, "backend"), stack };
}

describe("getAllStacks", () => {
  it("returns unique stack names in sorted order", () => {
    const resources = [
      stacked("b", "web"),
      stacked("a", "db"),
      stacked("c", "web"),
      stacked("d", "api"),
    ];

    expect(getAllStacks(resources)).toEqual(["api", "db", "web"]);
  });

  it("ignores resources without a stack", () => {
    const resources = [stacked("a"), stacked("b", "web"), stacked("c", "")];

    expect(getAllStacks(resources)).toEqual(["web"]);
  });

  it("returns an empty list when no resource has a stack", () => {
    expect(getAllStacks([stacked("a"), stacked("b")])).toEqual([]);
  });
});

describe("discoverStackNames", () => {
  it("uses the provided resources instead of walking the filesystem", () => {
    const resources = [stacked("a", "zeta"), stacked("b", "alpha")];

    expect(discoverStackNames("/nonexistent", resources)).toEqual(["alpha", "zeta"]);
  });
});

describe("discoverStacks", () => {
  it("groups resources by stack and sorts the stacks", () => {
    const resources = [
      stacked("api", "backend"),
      stacked("web", "frontend"),
      stacked("worker", "backend"),
      stacked("loose"),
    ];

    const stacks = discoverStacks(resources);

    expect(stacks.map((s) => s.name)).toEqual(["backend", "frontend"]);
    const backend = stacks[0];
    expect(backend.resourceCount).toBe(2);
    expect(backend.description).toBe("2 resources");
    expect(backend.resources.map((r) => r.name)).toEqual(["api", "worker"]);
    expect(stacks[1].description).toBe("1 resource");
  });

  it("returns no stacks when every resource is unstacked", () => {
    expect(discoverStacks([stacked("a"), stacked("b")])).toEqual([]);
  });
});

describe("getResourcesForStack", () => {
  it("returns only the resources in the named stack", () => {
    const resources = [stacked("api", "backend"), stacked("web", "frontend")];

    expect(getResourcesForStack("backend", resources)).toEqual([resources[0]]);
    expect(getResourcesForStack("missing", resources)).toEqual([]);
  });
});

describe("stackExists", () => {
  it("reports whether the stack name appears among the resources", () => {
    const resources = [stacked("api", "backend")];

    expect(stackExists("backend", resources)).toBe(true);
    expect(stackExists("frontend", resources)).toBe(false);
  });
});
