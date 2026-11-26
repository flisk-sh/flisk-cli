// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateStarlark, tiltAvailable } from "../../test-support/index.js";
import { canonicalCheckoutPath } from "../checkout-id.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const constants = join(
  repoRoot,
  "runtime",
  "engine",
  "topologies",
  "platform",
  "docker",
  "constants.star",
);
const tempDirs: string[] = [];

function projectRoot(kind: "main" | "worktree"): string {
  const root = mkdtempSync(join(tmpdir(), `flisk-db-golden-${kind}-`));
  tempDirs.push(root);
  mkdirSync(join(root, ".flisk"));
  if (kind === "main") {
    // A real checkout has a .git DIRECTORY; the Starlark helper must leave its names alone.
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  } else {
    // A linked worktree has a .git FILE that points at the repository's worktree metadata.
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/agent\n", "utf8");
    writeFileSync(
      join(root, ".flisk", ".project-id"),
      `${JSON.stringify({ id: "deadbee5", path: canonicalCheckoutPath(root) })}\n`,
      "utf8",
    );
  }
  writeFileSync(
    join(root, ".flisk", "project.json"),
    JSON.stringify({ project: { name: "golden-shop", version: "1.0.0" } }),
    "utf8",
  );
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe.skipIf(!tiltAvailable())("generated database names (#4698)", () => {
  it.each([
    { kind: "main" as const, suffix: "", db: "golden_shop_app" },
    { kind: "worktree" as const, suffix: "_deadbee5", db: "golden_shop_app_deadbee5" },
  ])("keeps the $kind checkout's generated names exact", ({ kind, suffix, db }) => {
    const root = projectRoot(kind);
    const expectedUrl = `postgresql://golden_shop:\${DB_PASSWORD}@golden_shop_postgres:5432/${db}`;
    const result = evaluateStarlark(constants, {
      env: { FLISK_PROJECT_ROOT: root },
      args: `load(${JSON.stringify(constants)}, 'PlatformDockerConstants')
if PlatformDockerConstants.checkout_db_suffix != ${JSON.stringify(suffix)}: fail('wrong suffix: ' + PlatformDockerConstants.checkout_db_suffix)
if PlatformDockerConstants.with_checkout_db_suffix('golden_shop_app') != ${JSON.stringify(db)}: fail('suffix helper changed: ' + PlatformDockerConstants.with_checkout_db_suffix('golden_shop_app'))
if PlatformDockerConstants.get_db_name('app') != ${JSON.stringify(db)}: fail('get_db_name changed: ' + PlatformDockerConstants.get_db_name('app'))
if PlatformDockerConstants.get_database_url_for_env(${JSON.stringify(db)}) != ${JSON.stringify(expectedUrl)}: fail('DATABASE_URL changed: ' + PlatformDockerConstants.get_database_url_for_env(${JSON.stringify(db)}))
if PlatformDockerConstants.with_checkout_db_suffix(${JSON.stringify(db)}) != ${JSON.stringify(db)}: fail('suffix is not idempotent')
`,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
  it("refuses a raw databaseName override that carries the checkout's reserved suffix", () => {
    const root = projectRoot("worktree");
    const loading = join(repoRoot, "runtime", "discovery", "manifest", "loading.star");
    const service = (databaseName: string) =>
      JSON.stringify({
        schemaVersion: "1.0",
        appName: "api",
        appType: "backend",
        stack: "app",
        databaseName,
      });
    const load = (databaseName: string) => {
      const dir = join(root, "svc");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "service.json"), service(databaseName), "utf8");
      return evaluateStarlark(loading, {
        env: { FLISK_PROJECT_ROOT: root },
        args: `load(${JSON.stringify(loading)}, 'load_manifest')
m = load_manifest(${JSON.stringify(dir)})
if m['databaseName'] != 'custom_db_deadbee5': fail('not scoped: ' + m['databaseName'])
`,
      });
    };
    expect(load("custom_db").status).toBe(0);
    const clash = load("custom_deadbee5");
    expect(clash.status).not.toBe(0);
    expect(`${clash.stdout}\n${clash.stderr}`).toContain("reserves");
  });
});
