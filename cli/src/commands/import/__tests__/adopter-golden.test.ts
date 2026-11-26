// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanEnv, createTempDir } from "../../../test-support/index.js";
import { findOnPath } from "../../../utils/which.js";
import { importInvocation } from "../invocation.js";

/**
 * Golden tests for the pinned importer against trimmed copies of the Compose files real adopters run
 * (fixtures/adopters/<name>/docker-compose.y*ml). A mapping change in a flisk-import release shows up here as a
 * changed service.json, before the pin moves and it lands in a pull request to someone else's repository. To
 * refresh a golden after a deliberate importer change, import the fixture with the pinned package and copy its
 * `services/` tree over `expected/services/`.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "adopters");

/** Importing runs `npx` or `bunx`; a machine with neither skips the goldens, like the Tilt-gated suites do. */
const runnerFound = findOnPath("npx") !== null || findOnPath("bunx") !== null;

/** A cold npx fetch of flisk-import plus the run itself, in milliseconds. */
const IMPORT_TIMEOUT_MS = 180_000;

interface ManifestSet {
  /** Paths under `services/`, relative to it. */
  files: string[];
  /** Parsed service.json by relative path. */
  manifests: Record<string, unknown>;
}

/** Copies a fixture into a fresh directory that keeps its name: the importer derives the project name from it. */
function stageFixture(fixtureDir: string): string {
  const parent = createTempDir("flisk-adopter-golden-");
  const projectDir = join(parent, basename(fixtureDir));
  cpSync(fixtureDir, projectDir, {
    recursive: true,
    filter: (source) => basename(source) !== "expected",
  });
  return projectDir;
}

/**
 * Runs the pinned importer the way `flisk import` would invoke it, captured and non-interactive.
 * FLISK_IMPORT_DOCKER=0 keeps the run on the plain YAML read: where `docker compose` exists, the importer
 * compares its `config` output, which writes a service's `models:` as an alphabetically sorted map instead of the
 * file's own order. The goldens pin the deterministic YAML result so they hold on machines with and without
 * Docker.
 */
function runImporter(projectDir: string): { status: number | null; output: string } {
  const invocation = importInvocation([".", "--yes"]);
  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- fixed test command; the shell is only for Windows .cmd shims
  const run = spawnSync(invocation.command, invocation.args, {
    cwd: projectDir,
    encoding: "utf-8",
    env: cleanEnv({ NO_COLOR: "1", FLISK_IMPORT_DOCKER: "0" }),
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    timeout: IMPORT_TIMEOUT_MS,
  });
  return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

/** Every service.json under `services/`, keyed by its path relative to that folder. */
function manifestsUnder(servicesDir: string): ManifestSet {
  const files: string[] = [];
  const manifests: Record<string, unknown> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name === "service.json") {
        const relative = path.slice(servicesDir.length + 1);
        files.push(relative);
        manifests[relative] = JSON.parse(readFileSync(path, "utf-8"));
      }
    }
  };
  if (existsSync(servicesDir)) walk(servicesDir);
  return { files, manifests };
}

describe.skipIf(!runnerFound)("importer adopter goldens", () => {
  const adopters = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("has at least the Lychee and nosia fixtures", () => {
    expect(adopters).toEqual(expect.arrayContaining(["lychee", "nosia"]));
  });

  it.each(adopters)("writes the golden service.json files for %s", (adopter) => {
    const fixtureDir = join(FIXTURES, adopter);
    const projectDir = stageFixture(fixtureDir);
    const run = runImporter(projectDir);
    expect(run.status, `importer output:\n${run.output}`).toBe(0);

    const generated = manifestsUnder(join(projectDir, "services"));
    const expected = manifestsUnder(join(fixtureDir, "expected", "services"));
    expect(generated.files, "the set of generated service.json files").toEqual(expected.files);
    for (const file of generated.files) {
      expect(generated.manifests[file], `services/${file}`).toEqual(expected.manifests[file]);
    }
  });
});
