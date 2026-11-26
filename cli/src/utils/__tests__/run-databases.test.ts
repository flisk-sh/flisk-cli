// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../types/index.js";
import {
  readRunDatabases,
  runDatabasesPath,
  runDatabaseUses,
  writeRunDatabases,
} from "../run-databases.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

function project(name = "shop"): string {
  const root = mkdtempSync(join(tmpdir(), "flisk-run-databases-"));
  tempDirs.push(root);
  mkdirSync(join(root, ".flisk"), { recursive: true });
  writeFileSync(
    join(root, ".flisk", "project.json"),
    JSON.stringify({ project: { name, version: "1.0.0" } }),
    "utf8",
  );
  return root;
}

function backend(stack: string, dependsOn: string[] = ["postgres"]): DiscoveredResource {
  return {
    name: `${stack}-api`,
    path: `/p/${stack}-api`,
    configPath: `/p/${stack}-api/service.json`,
    stack,
    config: { appName: `${stack}-api`, appType: "backend", dependsOn },
  };
}

describe("runDatabaseUses (#5132)", () => {
  it("names the shared-Postgres database of each stack whose services use it", () => {
    const root = project();
    expect(runDatabaseUses(root, [backend("api"), backend("web")])).toEqual([
      { stack: "api", name: "shop_api" },
      { stack: "web", name: "shop_web" },
    ]);
  });

  it("is empty when no selected resource uses the shared Postgres", () => {
    const root = project();
    expect(runDatabaseUses(root, [backend("api", ["other-service"])])).toEqual([]);
  });

  it("is empty without a project name", () => {
    const root = mkdtempSync(join(tmpdir(), "flisk-run-databases-"));
    tempDirs.push(root);
    expect(runDatabaseUses(root, [backend("api")])).toEqual([]);
  });
});

describe("run database record", () => {
  it("round-trips the databases a run recorded, inside a gitignored run directory", () => {
    const root = project();
    const uses = [
      { stack: "api", name: "shop_api" },
      { stack: "web", name: "shop_web" },
    ];
    writeRunDatabases(root, uses);

    expect(readRunDatabases(root)).toEqual(uses);
    expect(readFileSync(join(root, ".flisk", "run", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("reads null when no run wrote a record, or the record is not complete", () => {
    const root = project();
    expect(readRunDatabases(root)).toBeNull();

    mkdirSync(join(root, ".flisk", "run"), { recursive: true });
    writeFileSync(runDatabasesPath(root), "{not json", "utf8");
    expect(readRunDatabases(root)).toBeNull();

    writeFileSync(
      runDatabasesPath(root),
      JSON.stringify({ databases: [{ stack: "api" }, { stack: "api", name: "shop_api" }] }),
      "utf8",
    );
    expect(readRunDatabases(root)).toEqual([{ stack: "api", name: "shop_api" }]);
  });
});
