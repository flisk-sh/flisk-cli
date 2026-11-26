// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { ProjectConfig } from "../../../types/index.js";
import { FliskError } from "../../../utils/errors.js";
import { compileTemplate } from "../../mini-template.js";
import {
  ensureProjectRuntimeAssets,
  findCliAssetRoot,
  generateDatabaseManagementCompose,
  generateMasterConfigs,
  isTestFile,
  loadTemplate,
  ProjectConfigNotFoundError,
  readProjectConfig,
  staleServiceOutputs,
  TemplateEngine,
  verifyMasterConfigs,
} from "../../template-engine.js";

const fsState: {
  existsSync: MockInstance;
  actualExistsSync: ((filePath: string | Buffer | URL) => boolean) | null;
} = vi.hoisted(() => ({
  existsSync: vi.fn(),
  actualExistsSync: null as ((filePath: string | Buffer | URL) => boolean) | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsState.actualExistsSync = actual.existsSync;
  fsState.existsSync.mockImplementation(actual.existsSync);
  const mockedFs = { ...actual, existsSync: fsState.existsSync };
  return { ...mockedFs, default: mockedFs };
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const readEngine = (rel: string) =>
  fs.readFileSync(path.join(repoRoot, "runtime", "engine", rel), "utf-8").replace(/\r\n/g, "\n");

// Real template files, keyed by a substring that only appears in that specific
// file - regression coverage for the bug where loadTemplate joined a candidate
// *directory* (not the file) and silently fell through every candidate.
const REAL_TEMPLATES: Record<string, string> = {
  "TILT_RESOURCE_DEFAULTS.star.hbs": "get_resource_defaults",
  "TILT_TECH_STACK.star.hbs": "get_tech_stack",
  "Tiltfile.hbs": "Tiltfile",
  ".tiltignore.hbs": "TILT IGNORE FILE",
  "spec.master.hbs": "spec.master",
};

function baseProjectConfig(name: string) {
  return {
    version: "1.0",
    project: { name, version: "1.0.0" },
    phases: {
      pre_alpha: { name: "Pre-Alpha", description: "", enabledStacks: [] },
      alpha: { name: "Alpha", description: "", enabledStacks: [] },
      beta: { name: "Beta", description: "", enabledStacks: [] },
      out_of_scope: { name: "Out of Scope", description: "", enabledStacks: [] },
    },
    optional_infra: {
      monitoring: false,
      elk: false,
      debezium: false,
      golden_image: false,
      verdaccio: false,
    },
    discovery: { paths: ["services/*/*"] },
  };
}

// Complete ProjectConfig for the cases below; each test states only what it changes.
function projectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...baseProjectConfig("test-project"), ...overrides };
}

// Older fixtures include an explicit empty overrides object.
function completeProjectConfig(name: string) {
  return { ...baseProjectConfig(name), overrides: {} };
}

function mockExistsIgnoringRepoRuntime(
  originalExistsSync: (filePath: string | Buffer | URL) => boolean,
) {
  fsState.existsSync.mockImplementation((filePath) => {
    const resolved = String(filePath);
    if (
      resolved.startsWith(`${repoRoot}${path.sep}runtime${path.sep}`) ||
      (resolved.startsWith(`${repoRoot}${path.sep}`) &&
        resolved.endsWith(path.join("shared-platform-engineering", "docker-templates")))
    ) {
      return false;
    }
    return originalExistsSync(filePath);
  });
}

function writeProjectJson(projectRoot: string, config: unknown): void {
  fs.mkdirSync(path.join(projectRoot, ".flisk"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".flisk", "project.json"), JSON.stringify(config));
}

export type { ProjectConfig } from "../../../types/index.js";
export {
  afterEach,
  beforeEach,
  compileTemplate,
  completeProjectConfig,
  describe,
  ensureProjectRuntimeAssets,
  expect,
  FliskError,
  fileURLToPath,
  findCliAssetRoot,
  fs,
  fsState,
  generateDatabaseManagementCompose,
  generateMasterConfigs,
  isTestFile,
  it,
  loadTemplate,
  mockExistsIgnoringRepoRuntime,
  os,
  ProjectConfigNotFoundError,
  path,
  projectConfig,
  REAL_TEMPLATES,
  readEngine,
  readProjectConfig,
  repoRoot,
  staleServiceOutputs,
  TemplateEngine,
  verifyMasterConfigs,
  vi,
  writeProjectJson,
};

export function expectProjectConfigNotFound(caught: unknown, projectJsonPath: string) {
  expect(caught).toBeInstanceOf(ProjectConfigNotFoundError);
  expect((caught as Error).message).toBe(
    `Project config not found: ${projectJsonPath}. Run 'flisk project --yes' first.`,
  );
}

export function expectProjectConfigReadFailure(
  caught: unknown,
  projectJsonPath: string,
  expectedReason: string,
) {
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(
    `Could not read project.json at ${projectJsonPath}: ${expectedReason}`,
  );
  expect(caught).not.toBeInstanceOf(ProjectConfigNotFoundError);
}

export function readInstallDeps(projectRoot: string): string {
  return fs.readFileSync(
    path.join(projectRoot, "shared-platform-engineering", "docker-templates", "install-deps.sh"),
    "utf-8",
  );
}
