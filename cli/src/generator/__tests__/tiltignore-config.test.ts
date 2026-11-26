// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../../types/index.js";
import { normalizeProjectConfig } from "../project-config.js";
import { TemplateEngine } from "../template-engine.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const emptyPhases = Object.fromEntries(
  [
    ["pre_alpha", "Pre-Alpha"],
    ["alpha", "Alpha"],
    ["beta", "Beta"],
    ["out_of_scope", "Out of Scope"],
  ].map(([key, name]) => [key, { name, description: "", enabledStacks: [] }]),
) as unknown as ProjectConfig["phases"];
const baseConfig = {
  version: "1.0",
  project: { name: "ignore-project", version: "1.0.0" },
  discovery: { paths: ["services/*/*"] },
  optional_infra: {},
  phases: emptyPhases,
} as unknown as ProjectConfig;

const render = (tiltignore?: ProjectConfig["tiltignore"]) =>
  new TemplateEngine(join(repoRoot, "cli", "templates")).generateAll({
    ...baseConfig,
    tiltignore,
  })[".tiltignore"];

describe("generated .tiltignore patterns (#5387)", () => {
  it("anchors generic folder names to the project root or service output paths", () => {
    const text = render();
    expect(text).not.toContain("**/logs");
    expect(text).toContain("/logs");
    expect(text).toContain("services/*/*/build");
  });

  it("applies exclude and extra lines from project.json", () => {
    const text = render({
      exclude: ["/docker", "**/bun.lockb"],
      extra: ["src/generated/**"],
    });
    expect(text).not.toContain("/docker");
    expect(text).not.toContain("**/bun.lockb");
    expect(text).toContain("src/generated/**");
    expect(text).toContain("SYSTEM-GENERATED");
  });

  it("rejects non-array and multiline pattern settings", () => {
    const asObject = (tiltignore: unknown) => normalizeProjectConfig({ ...baseConfig, tiltignore });
    const badArray = asObject({ extra: ["ok\nbad"] });
    expect(badArray.ok).toBe(false);
    if (!badArray.ok) {
      expect(badArray.problems.map((problem) => problem.field)).toContain("tiltignore.extra");
    }
    const wrongType = asObject({ exclude: "**/logs" });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.problems.map((problem) => problem.field)).toContain("tiltignore.exclude");
    }
  });
});
