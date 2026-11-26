// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeCliPath } from "../safe-cli-path.js";

describe("safeCliPath", () => {
  it("accepts a path inside the temp directory", () => {
    const target = join(tmpdir(), "flisk-safe-path", "out.txt");
    expect(safeCliPath(target, "--output")).toContain("out.txt");
  });

  it("accepts a relative path under the working directory", () => {
    expect(safeCliPath("out/file.txt", "--output")).toContain("file.txt");
  });

  it("refuses a NUL byte and an empty path", () => {
    expect(() => safeCliPath("a\0b", "--output")).toThrow(/NUL/);
    expect(() => safeCliPath("", "--output")).toThrow(/non-empty/);
  });

  it("refuses a path outside the working, home and temp directories", () => {
    expect(() => safeCliPath("/etc/passwd", "--output")).toThrow(/outside/);
  });
});
