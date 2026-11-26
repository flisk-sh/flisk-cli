// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { DiscoveredStack } from "../../types/index.js";
import {
  checkDatabaseNamesInUse,
  type DatabaseInUseLookup,
  describeDatabasesInUseCollisions,
  duplicateDatabasesInUse,
} from "../doctor-databases-in-use.js";
import type { RunDatabaseUse } from "../run-databases.js";

const PROJECT = "shop";

function dbStacks(): DiscoveredStack[] {
  return [
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
}

function lookup(
  recorded: Record<string, RunDatabaseUse[] | null>,
  roots = Object.keys(recorded),
): DatabaseInUseLookup {
  return {
    runningRoots: () => roots,
    recordedUses: (root) => recorded[root] ?? null,
    stacksIn: dbStacks,
    projectNameIn: () => PROJECT,
  };
}

describe("checkDatabaseNamesInUse (#5132)", () => {
  it("warns when two running checkouts claim the same recorded database", async () => {
    const result = await checkDatabaseNamesInUse(
      lookup({
        "/main": [{ stack: "api", name: "shop_api" }],
        "/worktree": [{ stack: "api", name: "shop_api" }],
      }),
    );

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("shop_api");
    expect(result.message).toContain("/main");
    expect(result.message).toContain("/worktree");
    expect(result.fix).toContain("flisk down");
  });

  it("does not warn for checkouts whose records hold distinct databases", async () => {
    const result = await checkDatabaseNamesInUse(
      lookup({
        "/main": [{ stack: "api", name: "shop_api" }],
        "/worktree": [{ stack: "api", name: "shop_api_ab12cd34" }],
      }),
    );

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBeUndefined();
    expect(result.isSkipped).toBeUndefined();
    expect(result.message).toContain("only one running stack");
  });

  it("still warns for a run with no record, using the names a fresh start would derive", async () => {
    const result = await checkDatabaseNamesInUse(
      lookup({
        "/stale": null,
        "/main": [{ stack: "api", name: "shop_api" }],
      }),
    );

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("shop_api");
  });

  it("skips when no running stack uses a shared-Postgres database", async () => {
    const result = await checkDatabaseNamesInUse(lookup({ "/main": [] }));

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("No running stack");
  });

  it("skips roots without a project name", async () => {
    const result = await checkDatabaseNamesInUse({
      runningRoots: () => ["/gone"],
      recordedUses: () => null,
      stacksIn: () => [],
      projectNameIn: () => undefined,
    });

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
  });
});

describe("duplicateDatabasesInUse", () => {
  it("groups by database and ignores a second claim by the same checkout", () => {
    const use = (root: string, database: string) => ({
      root,
      projectName: PROJECT,
      stack: "api",
      database,
    });
    const duplicates = duplicateDatabasesInUse([
      use("/a", "shop_api"),
      use("/a", "shop_api"),
      use("/b", "shop_api"),
      use("/c", "shop_web"),
    ]);

    expect([...duplicates.keys()]).toEqual(["shop_api"]);
    expect(describeDatabasesInUseCollisions(duplicates)).toContain(
      "shop_api: shop/api (/a), shop/api (/b)",
    );
  });

  it("builds no message without duplicates", () => {
    expect(describeDatabasesInUseCollisions(new Map())).toBeNull();
  });
});
