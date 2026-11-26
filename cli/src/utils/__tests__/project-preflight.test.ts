// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FliskError } from "../errors.js";
import { preflightProjectFolder } from "../project-preflight.js";

describe("preflightProjectFolder", () => {
  const roots: string[] = [];
  const root = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-preflight-"));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a blank folder and a valid package.json", () => {
    const blank = root();
    expect(() => preflightProjectFolder(blank)).not.toThrow();

    const withManifest = root();
    writeFileSync(join(withManifest, "package.json"), '{"name":"team"}\n');
    expect(() => preflightProjectFolder(withManifest)).not.toThrow();
  });

  it("names the line of an invalid root package.json (#5419)", () => {
    const dir = root();
    writeFileSync(join(dir, "package.json"), '{\n  "name": hi\n}\n');

    expect(() => preflightProjectFolder(dir)).toThrow(FliskError);
    expect(() => preflightProjectFolder(dir)).toThrow(/package\.json is not valid JSON \(line 2\)/);
    expect(() => preflightProjectFolder(dir)).toThrow(/did not add workspaces/);
  });

  it("rejects a file where .flisk or services must be a directory (#5419)", () => {
    const fliskFile = root();
    writeFileSync(join(fliskFile, ".flisk"), "not a directory\n");
    expect(() => preflightProjectFolder(fliskFile)).toThrow(
      /\.flisk exists but is not a directory/,
    );

    const servicesFile = root();
    writeFileSync(join(servicesFile, "services"), "not a directory\n");
    expect(() => preflightProjectFolder(servicesFile)).toThrow(
      /services exists but is not a directory/,
    );

    const nested = root();
    mkdirSync(join(nested, "services"), { recursive: true });
    expect(() => preflightProjectFolder(nested)).not.toThrow();
  });
});
