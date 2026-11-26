// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFlisk } from "./project-e2e-helpers.js";

describe("flisk project gitignore generation", () => {
  let root = "";
  afterEach(() => {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
  });

  it("does not duplicate the Flisk header in .gitignore after project init (#5452)", () => {
    root = mkdtempSync(join(tmpdir(), "flisk-project-gitignore-"));
    execFileSync("git", ["init", "-q"], { cwd: root });

    runFlisk(["project", "--yes"], root);

    const gitignorePath = join(root, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);

    const content = readFileSync(gitignorePath, "utf-8");
    const headerMatches = content.match(/# Flisk \(generated files and secrets\)/g);
    expect(headerMatches).toHaveLength(1);
    expect(content).toContain(".flisk/.flisk-out/");
    expect(content).toContain(".env");

    // Re-running project setup must remain idempotent and not add extra headers
    runFlisk(["project", "--yes"], root);
    const reContent = readFileSync(gitignorePath, "utf-8");
    const reMatches = reContent.match(/# Flisk \(generated files and secrets\)/g);
    expect(reMatches).toHaveLength(1);
  }, 120_000);
});
