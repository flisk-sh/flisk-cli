// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../../../types/index.js";
import { PACKAGE_JSON, REQUIRED_PACKAGE_SCRIPTS } from "../../constants.js";
import { declaresCommand, declaresOwnDockerfile } from "../../native-service.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";

export function checkStartupScripts(): CheckResult {
  const projectRoot = findProjectRoot() ?? process.cwd();
  const resources = discoverResourcesFromRoot(projectRoot);

  const problems: string[] = [];

  for (const resource of resources) {
    // A native service runs the `command` from its service.json as a local
    // process, and a service with its own Dockerfile builds its image itself.
    // Neither path calls a package.json script, so there is nothing to require.
    if (declaresCommand(resource.config as Record<string, unknown> | undefined)) {
      continue;
    }
    if (declaresOwnDockerfile(resource.config)) {
      continue;
    }

    const packageJsonPath = join(resource.path, PACKAGE_JSON);
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const appType = resource.config?.appType ?? "backend";
    const requiredScripts = REQUIRED_PACKAGE_SCRIPTS[appType] ?? REQUIRED_PACKAGE_SCRIPTS.backend;

    let scripts: Record<string, string>;
    try {
      scripts = JSON.parse(readFileSync(packageJsonPath, "utf-8")).scripts ?? {};
    } catch {
      problems.push(`${resource.name} (package.json is invalid JSON)`);
      continue;
    }

    const missing = requiredScripts.filter((script) => !scripts[script]);
    if (missing.length > 0) {
      problems.push(`${resource.name}: missing "${missing.join('", "')}"`);
    }
  }

  if (problems.length === 0) {
    return {
      name: "Startup Scripts",
      didPass: true,
      message: "All services have required package.json scripts",
    };
  }

  return {
    name: "Startup Scripts",
    didPass: false,
    message: `Services missing required package.json scripts:\n    ${problems.join("\n    ")}`,
    fix: 'Add the missing scripts to each service\'s package.json, e.g.:\n    "dev": "bun run src/index.ts",\n    "build": "tsc",\n    "start": "bun run dist/index.js"',
  };
}
