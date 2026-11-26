// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../../../types/index.js";
import * as hub from "../../../doctor-project.js";
import * as discoveryModule from "../discovery.js";
import * as dockerPreflightModule from "../docker-preflight.js";
import * as generatedFilesModule from "../generated-files.js";
import * as startupScriptsModule from "../startup-scripts.js";
import * as tiltignoreNamesModule from "../tiltignore-names.js";
import * as typeDepsModule from "../type-deps.js";
import { useTempProject } from "./fixtures.js";

/**
 * The project-check map: a new project check is one module here plus one entry in
 * this table (and one re-export in `utils/doctor-project.ts`), which this suite enforces.
 * `read-json.ts` is the checks' shared helper, not a check module.
 */
const CHECK_MODULES: Record<string, Record<string, unknown>> = {
  "discovery.ts": discoveryModule,
  "docker-preflight.ts": dockerPreflightModule,
  "generated-files.ts": generatedFilesModule,
  "startup-scripts.ts": startupScriptsModule,
  "tiltignore-names.ts": tiltignoreNamesModule,
  "type-deps.ts": typeDepsModule,
};

const PROJECT_CHECKS = [
  "checkResourceDiscovery",
  "checkGeneratedFiles",
  "checkGeneratedProjectRuntimeAssets",
  "checkStartupScripts",
  "checkTiltIgnoredResourceNames",
  "checkTypeScriptTypeDependencies",
  "checkFrontendDockerPreflight",
] as const;

describe("doctor-project check registry", () => {
  const tempProject = useTempProject();
  const checksDir = fileURLToPath(new URL("..", import.meta.url));

  it("has one entry in the map per check module file", () => {
    const moduleFiles = readdirSync(checksDir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => name !== "read-json.ts");
    expect(moduleFiles.sort()).toEqual(Object.keys(CHECK_MODULES).sort());
  });

  it("re-exports every check function from the hub, unchanged", () => {
    const reexported: string[] = [];
    for (const [file, module] of Object.entries(CHECK_MODULES)) {
      for (const [name, value] of Object.entries(module)) {
        if (!name.startsWith("check") || typeof value !== "function") continue;
        reexported.push(name);
        expect((hub as Record<string, unknown>)[name], `${name} from ${file}`).toBe(value);
      }
    }
    expect(reexported.sort()).toEqual([...PROJECT_CHECKS].sort());
  });

  it("returns a named, JSON-serializable CheckResult from every check", () => {
    tempProject();
    for (const name of PROJECT_CHECKS) {
      const check = (hub as Record<string, unknown>)[name];
      expect(typeof check, name).toBe("function");
      const result = (check as () => CheckResult)();
      expect(typeof result.name, name).toBe("string");
      expect(result.name.length, name).toBeGreaterThan(0);
      expect(typeof result.didPass, name).toBe("boolean");
      expect(typeof result.message, name).toBe("string");
      expect(JSON.parse(JSON.stringify(result)), name).toEqual(result);
    }
  });
});
