// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The contract #4882 splits `types/index.ts` under: index.ts stays a pure barrel that
// re-exports every symbol of the per-domain modules, the 97-name surface is preserved,
// and no module reaches 400 lines.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TYPES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOMAIN_MODULES = readdirSync(TYPES_DIR)
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .sort();
const MODULE_IMPORTS = import.meta.glob<Record<string, unknown>>("../*.ts");

describe("types/index.js barrel", () => {
  it("re-exports every runtime export of every domain module, and nothing more", async () => {
    const barrel = (await import("../index.js")) as Record<string, unknown>;
    const expected = new Set<string>();
    for (const [path, load] of Object.entries(MODULE_IMPORTS)) {
      if (path.endsWith("/index.ts")) continue;
      const exports = await load();
      for (const name of Object.keys(exports)) {
        expected.add(name);
        expect(barrel, `${name} from ${path}`).toHaveProperty(name);
      }
    }
    for (const name of Object.keys(barrel)) {
      expect(expected.has(name), `unexpected export ${name}`).toBe(true);
    }
  });

  it("keeps the full 97-symbol export surface across the modules", () => {
    const declarations = DOMAIN_MODULES.flatMap(
      (module) =>
        readFileSync(join(TYPES_DIR, module), "utf8").match(
          /^export (?:interface|type|const|function) \w+/gm,
        ) ?? [],
    );
    expect(declarations).toHaveLength(97);
  });

  it("keeps every module, index.ts included, under 400 lines", () => {
    for (const module of [...DOMAIN_MODULES, "index.ts"]) {
      const lines = readFileSync(join(TYPES_DIR, module), "utf8").split("\n").length;
      expect(lines, module).toBeLessThan(400);
    }
  });

  it("defines nothing itself: index.ts only re-exports", () => {
    const index = readFileSync(join(TYPES_DIR, "index.ts"), "utf8");
    expect(index.match(/^export (?:interface|const|function|class) /gm)).toBeNull();
    expect(index.match(/^export type \w+\s*=/gm)).toBeNull();
  });
});
