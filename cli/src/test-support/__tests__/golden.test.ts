// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectGeneratedFile, expectPinnedHash, goldenUpdate } from "../golden.js";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);
const OTHER = "c".repeat(64);

describe("goldenUpdate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on only for UPDATE_GOLDEN=1", () => {
    vi.stubEnv("UPDATE_GOLDEN", "");
    expect(goldenUpdate()).toBe(false);
    vi.stubEnv("UPDATE_GOLDEN", "true");
    expect(goldenUpdate()).toBe(false);
    vi.stubEnv("UPDATE_GOLDEN", "1");
    expect(goldenUpdate()).toBe(true);
  });
});

describe("expectGeneratedFile", () => {
  let root: string;
  const golden = { file: "out/app.conf", contains: ["server {", "listen"] };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flisk-golden-file-"));
    mkdirSync(join(root, "out"), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the file text when the file exists with every marker", () => {
    writeFileSync(join(root, "out", "app.conf"), "server {\n  listen 80;\n}\n");
    expect(expectGeneratedFile(root, golden)).toBe("server {\n  listen 80;\n}\n");
  });

  it("fails when the file is missing", () => {
    expect(() => expectGeneratedFile(root, golden)).toThrowError(/out\/app\.conf exists/);
  });

  it("fails on an empty file", () => {
    writeFileSync(join(root, "out", "app.conf"), "");
    expect(() => expectGeneratedFile(root, golden)).toThrowError(/is not empty/);
  });

  it("fails when a marker is missing and names it", () => {
    writeFileSync(join(root, "out", "app.conf"), "server {\n}\n");
    expect(() => expectGeneratedFile(root, golden)).toThrowError(/contains listen/);
  });
});

describe("expectPinnedHash", () => {
  let dir: string;
  let testFile: string;
  const entry = (hash: string) =>
    `const GOLDEN = [\n  {\n    file: "x.conf",\n    sha256: "${hash}",\n  },\n];\n`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flisk-golden-pin-"));
    testFile = join(dir, "pins.test.ts");
    writeFileSync(testFile, entry(OLD));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const check = (pinned: string, actual: string) =>
    expectPinnedHash({ file: "x.conf", pinned, actual, testFile });

  it("passes when the hash matches", () => {
    vi.stubEnv("UPDATE_GOLDEN", "");
    expect(() => check(OLD, OLD)).not.toThrow();
    expect(readFileSync(testFile, "utf-8")).toBe(entry(OLD));
  });

  it("fails with the new hash in the message when it differs", () => {
    vi.stubEnv("UPDATE_GOLDEN", "");
    expect(() => check(OLD, NEW)).toThrowError(new RegExp(NEW));
    expect(readFileSync(testFile, "utf-8")).toBe(entry(OLD));
  });

  it("re-pins the hash in update mode instead of failing", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    check(OLD, NEW);
    expect(readFileSync(testFile, "utf-8")).toBe(entry(NEW));
  });

  it("re-pins every entry that shares a hash, like the two .tiltignore files", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    const shared = `[\n  { file: "a", sha256: "${OLD}" },\n  { file: "b", sha256: "${OLD}" },\n];\n`;
    writeFileSync(testFile, shared);
    check(OLD, NEW);
    expect(readFileSync(testFile, "utf-8")).toBe(shared.split(OLD).join(NEW));
  });

  it("touches nothing in update mode when the hash is unchanged", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    check(OLD, OLD);
    expect(log).not.toHaveBeenCalled();
    expect(readFileSync(testFile, "utf-8")).toBe(entry(OLD));
  });

  it("reports an entry another check already re-pinned", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    const shared = `[\n  { file: "a", sha256: "${OLD}" },\n  { file: "b", sha256: "${OLD}" },\n];\n`;
    writeFileSync(testFile, shared);
    check(OLD, NEW);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    check(OLD, NEW);
    expect(log).toHaveBeenCalledWith(`UPDATE_GOLDEN x.conf: already pinned to ${NEW}`);
  });

  it("prints a ready-to-paste line when the pin is not a quoted literal in the source", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    check(OTHER, NEW);
    expect(log).toHaveBeenCalledWith(`UPDATE_GOLDEN x.conf: sha256: "${NEW}"`);
    expect(readFileSync(testFile, "utf-8")).toBe(entry(OLD));
  });

  it("fills in an empty pin the same way", () => {
    vi.stubEnv("UPDATE_GOLDEN", "1");
    writeFileSync(testFile, entry(""));
    check("", NEW);
    expect(readFileSync(testFile, "utf-8")).toBe(entry(NEW));
  });
});
