// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createTempProject, type TempProjectSpec } from "../../../../test-support/temp-project.js";

/** A temp flisk project that is also the process cwd, so `findProjectRoot()` resolves it. */
export interface DoctorTestProject {
  /** Real (non-symlinked) project root. */
  root: string;
  /** Writes `content` to `<root>/<relativePath>`, creating parent directories. */
  writeFile(relativePath: string, content: string): void;
  /** Creates `<root>/<relativePath>` as a directory. */
  mkdir(relativePath: string): void;
  /**
   * Writes `services/<dir>/service.json` plus `files` (each relative to the service
   * dir). `appName` defaults to the last path segment, the way `flisk resource` names it.
   */
  writeService(dir: string, config: Record<string, unknown>, files?: Record<string, string>): void;
}

/**
 * Registers the cwd restore hook once per suite; the returned factory builds a fresh
 * temp project (and chdirs into it) inside `beforeEach` or a test body.
 */
export function useTempProject(): (spec?: TempProjectSpec) => DoctorTestProject {
  let originalCwd = "";
  beforeEach(() => {
    originalCwd = process.cwd();
  });
  afterEach(() => {
    process.chdir(originalCwd);
  });
  return (spec = {}) => {
    const root = createTempProject(spec);
    process.chdir(root);
    const writeFile = (relativePath: string, content: string): void => {
      const file = join(root, relativePath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    };
    return {
      root,
      writeFile,
      mkdir(relativePath) {
        mkdirSync(join(root, relativePath), { recursive: true });
      },
      writeService(dir, config, files = {}) {
        writeFile(
          join("services", dir, "service.json"),
          JSON.stringify({ appName: basename(dir), ...config }),
        );
        for (const [relativePath, content] of Object.entries(files)) {
          writeFile(join("services", dir, relativePath), content);
        }
      },
    };
  };
}
