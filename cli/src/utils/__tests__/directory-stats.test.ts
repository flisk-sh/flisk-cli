// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directoryStats } from "../directory-stats.js";

describe("directoryStats", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dir-stats-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sums file sizes under nested directories", () => {
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "service.json"), "12345");
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "1234567890");

    expect(directoryStats(root)).toEqual({ files: 2, bytes: 15 });
  });

  it("skips named directories and their contents", () => {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "keep.txt"), "abc");
    writeFileSync(join(root, "node_modules", "huge.js"), "x".repeat(1000));

    expect(directoryStats(root, ["node_modules"])).toEqual({ files: 1, bytes: 3 });
  });

  it("returns zeros for a missing root instead of throwing", () => {
    expect(directoryStats(join(root, "missing"))).toEqual({ files: 0, bytes: 0 });
  });
});
