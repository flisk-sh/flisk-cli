// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredStack } from "../../types/index.js";
import {
  checkDuplicateDatabaseNames,
  type DatabaseCollisionLookup,
  describeDatabaseNameCollisions,
  duplicateDatabaseNameUses,
} from "../doctor-database-names.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

function checkout(name: string, id?: string): string {
  const root = mkdtempSync(join(tmpdir(), `flisk-doctor-db-${name}-`));
  tempDirs.push(root);
  mkdirSync(join(root, ".flisk"));
  writeFileSync(
    join(root, ".flisk", "project.json"),
    JSON.stringify({ project: { name: "shop", version: "1.0.0" } }),
    "utf8",
  );
  if (id) {
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/task\n", "utf8");
    writeFileSync(join(root, ".flisk", ".project-id"), JSON.stringify({ id, path: root }), "utf8");
  } else {
    mkdirSync(join(root, ".git"));
  }
  return root;
}

const stacks = (): DiscoveredStack[] => [
  {
    name: "api",
    resources: [
      {
        name: "orders-api",
        path: "/p/orders-api",
        configPath: "/p/orders-api/service.json",
        stack: "api",
        config: { appName: "orders-api", appType: "backend", dependsOn: ["postgres"] },
      },
    ],
    resourceCount: 1,
  },
];

function lookup(roots: string[]): DatabaseCollisionLookup {
  return { runningRoots: () => roots, stacksIn: stacks };
}

describe("doctor database name collisions (#4698)", () => {
  it("warns when two running stacks resolve to the same name", async () => {
    const first = checkout("first");
    const second = checkout("second");
    const result = await checkDuplicateDatabaseNames(lookup([first, second]));

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("shop_api");
    expect(result.message).toContain("more than one running stack");
  });

  it("does not warn for two linked worktrees with different checkout ids", async () => {
    const first = checkout("first-worktree", "11111111");
    const second = checkout("second-worktree", "22222222");
    const result = await checkDuplicateDatabaseNames(lookup([first, second]));

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).not.toContain("These stacks write to the same database");
  });

  it("builds a readable message from the duplicate groups", () => {
    const duplicates = duplicateDatabaseNameUses([
      { root: "/a", projectName: "shop", stack: "api", database: "shop_api" },
      { root: "/b", projectName: "shop", stack: "api", database: "shop_api" },
    ]);
    expect(describeDatabaseNameCollisions(duplicates)).toContain(
      "shop_api: shop/api (/a), shop/api (/b)",
    );
  });
});
