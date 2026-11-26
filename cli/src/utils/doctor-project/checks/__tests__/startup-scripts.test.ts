// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKEND_LANGUAGES } from "../../../../backend-languages/registry.js";
import { createPackageJson, createServiceJson } from "../../../../commands/resource.js";
import { REQUIRED_PACKAGE_SCRIPTS } from "../../../constants.js";
import { checkStartupScripts } from "../startup-scripts.js";
import { type DoctorTestProject, useTempProject } from "./fixtures.js";

// Every Flisk starter ships some appType whose package.json a person did not edit.
// The keys are the `appType` values the starters actually use, so a change to one of
// them keeps matching a service that exists rather than a type nobody scaffolds.
const STARTER_APP_TYPES = ["agent", "backend", "frontend", "mcp", "migrator", "worker"] as const;

describe("REQUIRED_PACKAGE_SCRIPTS", () => {
  it("requires only start for a migrator", () => {
    // A migrator runs `prisma migrate deploy` once and exits. The generated
    // Dockerfile skips the backend compiler stage for it (it reuses the service's
    // production dependency stage) and uses migrate.sh as its entrypoint, so neither
    // `dev` nor `build` is ever invoked (#4577).
    expect(REQUIRED_PACKAGE_SCRIPTS.migrator).toEqual(["start"]);
  });

  it("keeps every other starter appType at its full requirement", () => {
    expect(REQUIRED_PACKAGE_SCRIPTS.backend).toEqual(["dev", "build", "start"]);
    expect(REQUIRED_PACKAGE_SCRIPTS.worker).toEqual(["dev", "build", "start"]);
    expect(REQUIRED_PACKAGE_SCRIPTS.mcp).toEqual(["dev", "build", "start"]);
    expect(REQUIRED_PACKAGE_SCRIPTS.agent).toEqual(["dev", "build", "start"]);
    expect(REQUIRED_PACKAGE_SCRIPTS.frontend).toEqual(["dev", "build"]);
  });

  it("requires no script for the types that ship no code", () => {
    expect(REQUIRED_PACKAGE_SCRIPTS.database).toEqual([]);
    expect(REQUIRED_PACKAGE_SCRIPTS["bring-your-own"]).toEqual([]);
  });

  it("declares a requirement for every starter appType", () => {
    for (const appType of STARTER_APP_TYPES) {
      expect(REQUIRED_PACKAGE_SCRIPTS[appType]).toBeDefined();
    }
  });
});

describe("checkStartupScripts", () => {
  const tempProject = useTempProject();
  let project: DoctorTestProject;

  function writeService(
    relativeDir: string,
    appType: string,
    scripts: Record<string, string> | "invalid",
    extraConfig: Record<string, unknown> = {},
  ): void {
    project.writeService(
      relativeDir,
      { appType, ...extraConfig },
      {
        "package.json":
          scripts === "invalid"
            ? "{ not json"
            : JSON.stringify({ name: basename(relativeDir), scripts }, null, 2),
      },
    );
  }

  it("passes a migrator that only has start", () => {
    project = tempProject();
    writeService("agents/agent-migrator", "migrator", {
      migrate: "prisma migrate deploy",
      start: "prisma migrate deploy",
    });

    const result = checkStartupScripts();
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBeUndefined();
    expect(result.message).toBe("All services have required package.json scripts");
  });

  it("passes a migrator whose only extra script is build", () => {
    project = tempProject();
    writeService("app/migrations", "migrator", {
      build: "tsc",
      migrate: "prisma migrate deploy && bun run dist/seeders/run.js",
      start: "prisma migrate deploy && bun run dist/seeders/run.js",
    });

    expect(checkStartupScripts().didPass).toBe(true);
  });

  it("still fails a migrator with no start script", () => {
    project = tempProject();
    writeService("app/migrations", "migrator", { migrate: "prisma migrate deploy" });

    const result = checkStartupScripts();
    expect(result.didPass).toBe(false);
    expect(result.message).toContain('migrations: missing "start"');
    expect(result.message).not.toContain('missing "dev"');
    expect(result.message).not.toContain('missing "build"');
  });

  it("skips a native service whose command runs it, with no scripts at all", () => {
    // The generated agent starters declare `command` and run it as a local process:
    // Flisk never builds them or calls a package.json script, so an empty
    // package.json is not a missing script (#4577).
    project = tempProject();
    writeService("agents/planner", "backend", {}, { command: "node server.mjs", port: 4300 });

    expect(checkStartupScripts().didPass).toBe(true);
  });

  it("skips a service that ships its own top-level dockerfile", () => {
    // A custom Dockerfile owns the image build, so Flisk does not call `build`.
    // The portal starter is this shape: a backend with dev and start only.
    project = tempProject();
    writeService(
      "app/web",
      "backend",
      { dev: "bun --watch src/index.ts", start: "bun src/index.ts" },
      { dockerfile: "Dockerfile" },
    );

    expect(checkStartupScripts().didPass).toBe(true);
  });

  it("skips a service that declares build.dockerfile, the nested spelling", () => {
    project = tempProject();
    writeService(
      "app/web",
      "backend",
      { dev: "bun --watch src/index.ts", start: "bun src/index.ts" },
      { build: { dockerfile: "Dockerfile", context: "." } },
    );

    expect(checkStartupScripts().didPass).toBe(true);
  });

  it("still fails a backend missing build", () => {
    project = tempProject();
    writeService("app/web", "backend", {
      dev: "bun --watch src/index.ts",
      start: "bun src/index.ts",
    });

    const result = checkStartupScripts();
    expect(result.didPass).toBe(false);
    expect(result.message).toContain('web: missing "build"');
  });

  it("still fails a frontend missing dev and build", () => {
    project = tempProject();
    writeService("app/web", "frontend", { start: "bun run start" });

    const result = checkStartupScripts();
    expect(result.didPass).toBe(false);
    expect(result.message).toContain('web: missing "dev", "build"');
  });

  it("skips a service that has no package.json at all", () => {
    project = tempProject();
    project.writeService("app/web", { appType: "backend" });

    expect(checkStartupScripts().didPass).toBe(true);
  });

  it("passes a project whose every service meets its own type's requirement", () => {
    // The script sets the starters ship, one service per appType.
    project = tempProject();
    writeService("agents/agent", "agent", {
      dev: "bun run --watch src/index.ts",
      build: "tsc",
      start: "bun run dist/index.js",
    });
    writeService("agents/tools", "mcp", {
      dev: "bun run --watch src/index.ts",
      build: "tsc",
      start: "bun run dist/index.js",
    });
    writeService("agents/agent-migrator", "migrator", {
      migrate: "prisma migrate deploy",
      start: "prisma migrate deploy",
    });
    writeService("app/api", "backend", {
      dev: "bun run --watch src/index.ts",
      build: "tsc",
      start: "bun run dist/index.js",
    });
    writeService("app/worker", "worker", {
      dev: "bun run --watch src/index.ts",
      build: "tsc",
      start: "bun run dist/index.js",
    });
    writeService("app/web", "frontend", {
      dev: "vite --host 0.0.0.0 --port 3210",
      build: "tsc --noEmit && vite build",
    });

    const result = checkStartupScripts();
    expect(result.didPass).toBe(true);
    expect(result.message).toBe("All services have required package.json scripts");
  });

  it("reports a package.json that is not valid JSON", () => {
    project = tempProject();
    writeService("agents/agent-migrator", "migrator", "invalid");

    const result = checkStartupScripts();
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("agent-migrator (package.json is invalid JSON)");
  });

  /**
   * #4968: every backend the scaffold can emit must pass this check before any
   * edit. Each row writes the real `flisk resource` manifest and the real
   * emitted files, so a scaffold that drops a required script fails here.
   */
  it.each(Object.keys(BACKEND_LANGUAGES))("passes a freshly scaffolded %s backend", (language) => {
    project = tempProject();
    const name = `${language}-api`;

    // Provider-owned languages (python, go, rust, node) emit their own files;
    // Bun's package.json comes from the shared scaffold in resource.ts.
    const files = Object.fromEntries(
      (
        BACKEND_LANGUAGES[language]?.createFiles?.(name) ?? [
          { filename: "package.json", content: JSON.stringify(createPackageJson(name, "backend")) },
        ]
      ).map((file) => [file.filename, file.content]),
    );
    project.writeService(
      `app/${name}`,
      createServiceJson(name, "backend", "app", 4000, [], undefined, language),
      files,
    );

    const result = checkStartupScripts();
    expect(result.didPass, result.message).toBe(true);
  });
});
