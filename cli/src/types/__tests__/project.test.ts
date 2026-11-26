// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { JsonValue } from "../json.js";
import type { ProjectCapabilities, ProjectConfig } from "../project.js";

describe("project config types", () => {
  it("shapes a .flisk/project.json document", () => {
    const overrides: Record<string, JsonValue> = { theme: "dark" };
    const config: ProjectConfig = {
      repos: [{ url: "https://example.com/repo.git", dir: "vendor/repo", branch: "main" }],
      version: "2",
      project: { name: "demo", version: "1.0.0" },
      capabilities: { gateway: true, database: false } satisfies ProjectCapabilities,
      phases: {
        pre_alpha: { name: "pre-alpha", description: "d", enabledStacks: ["core"] },
        alpha: { name: "alpha", description: "d", enabledStacks: [] },
        beta: { name: "beta", description: "d", enabledStacks: [] },
        out_of_scope: { name: "oos", description: "d", enabledStacks: [] },
      },
      stacks: {
        alpha: { name: "alpha", description: "d", services: ["api"] },
        pre_alpha: { name: "pre-alpha", description: "d", services: [] },
        beta: { name: "beta", description: "d", services: [] },
        out_of_scope: { name: "oos", description: "d", services: [] },
      },
      always_enabled_infra: ["monitoring"],
      composeProjectNames: { core: "demo-core" },
      optional_infra: {
        monitoring: true,
        elk: false,
        debezium: false,
        golden_image: false,
        verdaccio: false,
      },
      discovery: { paths: ["services"] },
      overrides,
      orchestration: { source: "tiltfile", path: "Tiltfile" },
    };
    expect(config.discovery.paths).toEqual(["services"]);
    expect(config.capabilities?.database).toBe(false);
    expect(config.orchestration?.source).toBe("tiltfile");
  });
});
