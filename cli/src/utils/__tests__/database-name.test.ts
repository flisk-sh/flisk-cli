// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalCheckoutPath } from "../checkout-id.js";
import {
  assertCheckoutIdentityPersisted,
  checkoutDatabaseSuffix,
  checkoutScopedDatabaseUrl,
  databaseNameFromUrl,
  isLinkedGitWorktree,
  scopeDatabaseName,
  sharedPostgresDatabaseName,
} from "../database-name.js";
import { groupSharedPostgres } from "../shared-infra.js";

const tempDirs: string[] = [];

function checkout(name: string, id?: string, linked = true): string {
  const root = mkdtempSync(join(tmpdir(), `flisk-db-name-${name}-`));
  tempDirs.push(root);
  mkdirSync(join(root, ".flisk"));
  if (linked) {
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/feature\n", "utf8");
  } else {
    mkdirSync(join(root, ".git"));
  }
  if (id) {
    writeFileSync(
      join(root, ".flisk", ".project-id"),
      `${JSON.stringify({ id, path: canonicalCheckoutPath(root) })}\n`,
      "utf8",
    );
  }
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("isLinkedGitWorktree", () => {
  it("recognizes a .git file that starts with gitdir:", () => {
    expect(isLinkedGitWorktree(checkout("linked", "a1b2c3d4"))).toBe(true);
  });

  it("rejects the main checkout's .git directory and a folder outside git", () => {
    expect(isLinkedGitWorktree(checkout("main", undefined, false))).toBe(false);
    const plain = mkdtempSync(join(tmpdir(), "flisk-db-name-plain-"));
    tempDirs.push(plain);
    expect(isLinkedGitWorktree(plain)).toBe(false);
  });
});

describe("checkoutDatabaseSuffix and sharedPostgresDatabaseName", () => {
  it("keeps the historical name in the main checkout", () => {
    const main = checkout("main", undefined, false);
    expect(checkoutDatabaseSuffix(main)).toBe("");
    expect(sharedPostgresDatabaseName("auth-user", "my-shop", main)).toBe("auth_user_my_shop");
    expect(sharedPostgresDatabaseName("auth-user", "my-shop")).toBe("auth_user_my_shop");
  });

  it("uses the persisted checkout id for a linked worktree", () => {
    const worktree = checkout("worktree", "deadbee5");
    expect(checkoutDatabaseSuffix(worktree)).toBe("_deadbee5");
    expect(sharedPostgresDatabaseName("auth-user", "my-shop", worktree)).toBe(
      "auth_user_my_shop_deadbee5",
    );
  });

  it("gives two linked worktrees of one project different database names", () => {
    const first = checkout("first", "11111111");
    const second = checkout("second", "22222222");
    const firstDb = sharedPostgresDatabaseName("acme-shop", "api", first);
    const secondDb = sharedPostgresDatabaseName("acme-shop", "api", second);
    expect(firstDb).toBe("acme_shop_api_11111111");
    expect(secondDb).toBe("acme_shop_api_22222222");
    expect(firstDb).not.toBe(secondDb);
  });

  it("gives every stack in one worktree the same suffix", () => {
    const worktree = checkout("stacks", "c0ffee42");
    expect(sharedPostgresDatabaseName("shop", "billing-api", worktree)).toBe(
      "shop_billing_api_c0ffee42",
    );
    expect(sharedPostgresDatabaseName("shop", "orders", worktree)).toBe("shop_orders_c0ffee42");
  });
});

describe("groupSharedPostgres with git worktrees (#4698)", () => {
  function stacks() {
    return [
      {
        name: "api",
        resources: [
          {
            name: "orders-api",
            path: "/p/orders-api",
            configPath: "/p/orders-api/service.json",
            stack: "api",
            config: { dependsOn: ["postgres"] },
          },
        ],
        resourceCount: 1,
      },
    ] as Parameters<typeof groupSharedPostgres>[1];
  }

  it("shows the suffixed name in status for a worktree and the plain name for main", () => {
    const main = checkout("status-main", undefined, false);
    const worktree = checkout("status-worktree", "abcdef12");
    expect(groupSharedPostgres("pilot", stacks(), { projectRoot: main })?.databases[0]?.name).toBe(
      "pilot_api",
    );
    expect(
      groupSharedPostgres("pilot", stacks(), { projectRoot: worktree })?.databases[0]?.name,
    ).toBe("pilot_api_abcdef12");
  });

  it("keeps rows written through the 'same' table isolated between worktrees", () => {
    const first = checkout("rows-first", "aaaaaaaa");
    const second = checkout("rows-second", "bbbbbbbb");
    const firstDb = sharedPostgresDatabaseName("acme-shop", "api", first);
    const secondDb = sharedPostgresDatabaseName("acme-shop", "api", second);

    // A logical stand-in for `INSERT INTO notes` in each checkout's provisioned database. A real two-worktree
    // Postgres integration needs Docker/Tilt and is tracked separately; this pins the naming that makes it possible.
    const tables = new Map<string, string[]>([
      [firstDb, ["row-from-first"]],
      [secondDb, ["row-from-second"]],
    ]);
    expect(tables.get(firstDb)).toEqual(["row-from-first"]);
    expect(tables.get(secondDb)).toEqual(["row-from-second"]);
    expect(tables.get(firstDb)).not.toContain("row-from-second");
    expect(tables.get(secondDb)).not.toContain("row-from-first");
  });
});

describe("checkoutScopedDatabaseUrl", () => {
  it("rewrites only the generated database segment and preserves the query", () => {
    const worktree = checkout("url", "1234abcd");
    const url = "postgresql://postgres:secret@postgres:5432/app_dev?schema=public";
    const scoped = checkoutScopedDatabaseUrl(url, worktree);
    expect(scoped).toBe(
      "postgresql://postgres:secret@postgres:5432/app_dev_1234abcd?schema=public",
    );
    expect(databaseNameFromUrl(scoped)).toBe("app_dev_1234abcd");
  });

  it("is idempotent and a no-op in the main checkout", () => {
    const worktree = checkout("url-idempotent", "1234abcd");
    const main = checkout("url-main", undefined, false);
    const scoped = checkoutScopedDatabaseUrl("postgres://u:p@postgres:5432/app_dev", worktree);
    expect(checkoutScopedDatabaseUrl(scoped, worktree)).toBe(scoped);
    expect(checkoutScopedDatabaseUrl("postgres://u:p@postgres:5432/app_dev", main)).toBe(
      "postgres://u:p@postgres:5432/app_dev",
    );
  });
});

describe("scopeDatabaseName (63-byte bound)", () => {
  it("leaves a name that fits unchanged apart from the suffix", () => {
    expect(scopeDatabaseName("shop_api", "_1234abcd")).toBe("shop_api_1234abcd");
    expect(scopeDatabaseName("shop_api_1234abcd", "_1234abcd")).toBe("shop_api_1234abcd");
    expect(scopeDatabaseName("shop_api", "")).toBe("shop_api");
  });

  it("keeps the checkout id intact, stays within 63 bytes and keeps long names distinct", () => {
    const base = `p_${"a".repeat(60)}`;
    const other = `p_${"a".repeat(59)}b`;
    const one = scopeDatabaseName(base, "_1234abcd");
    const two = scopeDatabaseName(other, "_1234abcd");
    const elsewhere = scopeDatabaseName(base, "_cafebabe");
    expect(one.length).toBeLessThanOrEqual(63);
    expect(one.endsWith("_1234abcd")).toBe(true);
    expect(two).not.toBe(one);
    expect(elsewhere).not.toBe(one);
    expect(scopeDatabaseName(one, "_1234abcd")).toBe(one);
  });

  it("pins the shortened form so the Starlark engine can be checked against it", () => {
    // constants.star computes the same 32-bit FNV-1a; this value was checked against a Tilt evaluation of that function.
    expect(scopeDatabaseName(`p_${"a".repeat(60)}`, "_1234abcd")).toBe(
      `p_${"a".repeat(43)}_e408960a_1234abcd`,
    );
  });
});

describe("assertCheckoutIdentityPersisted", () => {
  it("passes for the main checkout and for a worktree with a stored record", () => {
    expect(() =>
      assertCheckoutIdentityPersisted(checkout("persist-main", undefined, false)),
    ).not.toThrow();
    expect(() => assertCheckoutIdentityPersisted(checkout("persist-ok", "1234abcd"))).not.toThrow();
  });

  it("refuses a worktree with no stored record, which the engine could not read", () => {
    expect(() => assertCheckoutIdentityPersisted(checkout("persist-missing"))).toThrow(
      /database names/,
    );
  });
});
