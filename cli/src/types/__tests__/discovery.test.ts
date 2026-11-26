// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createTempProject } from "../../test-support/index.js";
import { discoverResourcesWithProblems } from "../../utils/services.js";
import type {
  DiscoveredResource,
  DiscoveredStack,
  DiscoveryContext,
  DiscoveryProblem,
} from "../discovery.js";

describe("discovery types", () => {
  it("describe discoverResources output, skipped files included", () => {
    const root = createTempProject({
      stacks: { core: { api: { appType: "backend", port: 4100 } } },
      resources: { jobs: { appType: "worker" } },
      files: { "services/broken/service.json": "{ not json" },
    });
    const { resources, problems } = discoverResourcesWithProblems(root);

    const typed: DiscoveredResource[] = resources;
    const typedProblems: DiscoveryProblem[] = problems;

    const api = typed.find((r) => r.name === "api");
    expect(api?.stack).toBe("core");
    expect(api?.port).toBe(4100);
    expect(api?.type).toBe("backend");
    expect(api?.config?.appName).toBe("api");
    expect(api?.configPath.endsWith("service.json")).toBe(true);

    const unassigned = typed.filter((r) => r.stack === undefined);
    expect(unassigned.map((r) => r.name)).toEqual(["jobs"]);

    expect(typedProblems).toHaveLength(1);
    expect(typedProblems[0]?.path).toContain("broken");
    expect(typedProblems[0]?.reason).toMatch(/invalid JSON/i);

    const stack: DiscoveredStack = {
      name: "core",
      resources: [api as DiscoveredResource],
      resourceCount: 1,
    };
    const context: DiscoveryContext = {
      resources: typed,
      problems: typedProblems,
      stacks: [stack],
      stackNames: ["core"],
      unassignedResources: unassigned,
      resourcesByStack: new Map([["core", [api as DiscoveredResource]]]),
    };
    expect(context.stacks[0]?.resources[0]?.name).toBe("api");
    expect(context.resourcesByStack.get("core")?.[0]?.type).toBe("backend");
    expect(context.unassignedResources[0]?.type).toBe("worker");
  });
});
