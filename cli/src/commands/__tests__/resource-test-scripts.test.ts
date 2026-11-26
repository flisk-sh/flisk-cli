// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject, runFlisk } from "../../test-support/index.js";
import { createPackageJson } from "../resource.js";

describe("resource scaffold tests", () => {
  it.each(["backend", "mcp", "agent", "worker", "frontend"])(
    "createPackageJson_runsTestsOnce_%s",
    (type) => {
      const pkg = createPackageJson("sample", type);
      const scripts = pkg.scripts;
      expect(scripts.test).toBe("bun test");
      expect(scripts["test:watch"]).toBe("bun test --watch");
      expect(pkg.devDependencies).not.toHaveProperty("vitest");
    },
  );

  it.each(["backend", "worker", "mcp", "agent", "frontend"])(
    "resource_generatesBunTestImports_%s",
    (type) => {
      const root = createTempProject();
      const result = runFlisk(["resource", "sample", "--type", type, "--stack", "main", "--yes"], {
        cwd: root,
        input: "",
      });
      expect(result.status, result.stderr).toBe(0);
      const service = join(root, "services", "main", "sample");
      const pkg = JSON.parse(readFileSync(join(service, "package.json"), "utf-8"));
      const test = readFileSync(join(service, "tests", "sample.test.ts"), "utf-8");
      expect(pkg.scripts.test).toBe("bun test");
      expect(pkg.scripts["test:watch"]).toBe("bun test --watch");
      expect(pkg.devDependencies).not.toHaveProperty("vitest");
      expect(test).toContain("from 'bun:test'");
      expect(test).not.toContain("from 'vitest'");
    },
  );

  it.each([{ frameworkArgs: [] }, { frameworkArgs: ["--framework", "hono"] }])(
    "resource_generatesBackendHealthTest_%j",
    ({ frameworkArgs }) => {
      const root = createTempProject();
      const result = runFlisk(
        ["resource", "api", "--type", "backend", "--stack", "main", "--yes", ...frameworkArgs],
        { cwd: root, input: "" },
      );
      expect(result.status, result.stderr).toBe(0);
      const test = readFileSync(
        join(root, "services", "main", "api", "tests", "api.test.ts"),
        "utf-8",
      );
      expect(test).toContain("/health");
      expect(test).toContain("toBe(200)");
      expect(test).toContain("service: 'api'");
      expect(test).not.toContain("it.todo");
    },
  );
});
