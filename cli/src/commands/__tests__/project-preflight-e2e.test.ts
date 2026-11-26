// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cliBin, repoRoot } from "./project-e2e-helpers.js";

function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cliBin, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, FLISK_EXTENSION_SOURCE: repoRoot },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("flisk project preflight (#5419)", () => {
  const roots: string[] = [];
  const freshRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-project-preflight-"));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an invalid root package.json before writing anything", () => {
    const root = freshRoot();
    writeFileSync(join(root, "package.json"), "hi\n");

    const result = run(["project", "--yes"], root);

    expect(result.status).toBe(1);
    expect(result.output).toContain("package.json is not valid JSON (line 1)");
    expect(result.output).toContain("Fix package.json");
    expect(existsSync(join(root, ".flisk"))).toBe(false);
    expect(existsSync(join(root, ".tiltignore"))).toBe(false);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe("hi\n");
  });

  it("reports the invalid manifest in the JSON envelope", () => {
    const root = freshRoot();
    writeFileSync(join(root, "package.json"), "hi\n");

    const result = run(["project", "--yes", "--json"], root);
    const envelope = JSON.parse(result.stdout) as {
      data: unknown;
      errors: Array<{ message: string; suggestions?: string[] }>;
    };

    expect(result.status).toBe(1);
    expect(envelope.data).toBeNull();
    expect(envelope.errors[0]?.message).toContain("package.json is not valid JSON (line 1)");
    expect(envelope.errors[0]?.suggestions).toContain("Fix package.json");
  });

  it("names a conflicting services file instead of failing mid-write", () => {
    const root = freshRoot();
    writeFileSync(join(root, "services"), "not a directory\n");

    const result = run(["project", "--yes"], root);

    expect(result.status).toBe(1);
    expect(result.output).toContain("services exists but is not a directory");
    expect(existsSync(join(root, ".flisk"))).toBe(false);
    expect(existsSync(join(root, "package.json"))).toBe(false);
  });
});
