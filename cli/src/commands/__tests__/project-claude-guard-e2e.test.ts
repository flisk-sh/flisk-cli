// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFlisk } from "./project-e2e-helpers.js";

describe("flisk project with existing Claude settings (#5425)", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("says the guard is not wired and leaves no orphan hook script", () => {
    const root = mkdtempSync(join(tmpdir(), "flisk-project-guard-"));
    roots.push(root);
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), "{}\n");

    const output = runFlisk(["project", "--yes", "--name", "guard"], root);

    expect(output).toContain("does not run the Flisk generated-file guard");
    expect(output).toContain("PreToolUse");
    expect(existsSync(join(root, ".claude", "hooks", "flisk-generated-guard.mjs"))).toBe(false);
    expect(readFileSync(join(root, ".claude", "settings.json"), "utf-8")).toBe("{}\n");
  });
});
