// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredResource } from "../types/index.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { discoverStacks } from "./services.js";
import { groupSharedPostgres } from "./shared-infra.js";

/** One shared-Postgres database a running checkout actually uses, with the stack it belongs to. */
export interface RunDatabaseUse {
  stack: string;
  name: string;
}

/**
 * Where a run records the shared-Postgres database names it actually uses: `.flisk/run/databases.json`.
 *
 * `flisk up` writes the record at start so `flisk doctor` can compare the names running checkouts claim, not the
 * names a fresh `flisk up` would derive: a stack started before a naming change keeps its old database until it
 * restarts, which the derived names cannot see (#5132). The directory carries the same keep-out-of-git marker
 * `.flisk/native/` uses: the record names this machine's run, so it must never be committed.
 */
export const RUN_STATE_DIR = join(".flisk", "run");
const RUN_DATABASES_FILE = "databases.json";

export function runDatabasesPath(projectRoot: string): string {
  return join(projectRoot, RUN_STATE_DIR, RUN_DATABASES_FILE);
}

/**
 * The shared-Postgres databases a run of `resources` uses: `groupSharedPostgres` resolves them the same way the
 * next `flisk up` does, so the names a worktree scopes to its checkout are recorded as scoped once that scoping
 * exists (#4698). Empty when no selected resource touches the shared Postgres or the project opts out.
 */
export function runDatabaseUses(
  projectRoot: string,
  resources: readonly DiscoveredResource[],
): RunDatabaseUse[] {
  const projectName = readProjectNameOrUndefined(projectRoot);
  if (!projectName) return [];
  const group = groupSharedPostgres(projectName, discoverStacks([...resources]), { projectRoot });
  return (group?.databases ?? []).map(({ stack, name }) => ({ stack, name }));
}

/**
 * Records the databases a run uses. Written on every `flisk up` so the record always describes the latest start;
 * an absent or unreadable record only means the check falls back to derived names. Never throws: a read-only
 * checkout loses the record, not the run.
 */
export function writeRunDatabases(projectRoot: string, uses: readonly RunDatabaseUse[]): void {
  try {
    const dir = join(projectRoot, RUN_STATE_DIR);
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
    writeFileSync(
      runDatabasesPath(projectRoot),
      `${JSON.stringify({ databases: uses }, null, 2)}\n`,
    );
  } catch {
    // Best effort.
  }
}

/** The databases the run on record uses, or null when no complete record exists. */
export function readRunDatabases(projectRoot: string): RunDatabaseUse[] | null {
  try {
    const parsed = JSON.parse(readFileSync(runDatabasesPath(projectRoot), "utf-8")) as {
      databases?: unknown;
    };
    if (!Array.isArray(parsed.databases)) return null;
    return parsed.databases.filter(
      (use): use is RunDatabaseUse =>
        typeof use === "object" &&
        use !== null &&
        typeof (use as RunDatabaseUse).stack === "string" &&
        typeof (use as RunDatabaseUse).name === "string",
    );
  } catch {
    return null;
  }
}
