// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { trimChars, trimEndChars, trimStartChars } from "../trim-chars.js";

describe("trim-chars", () => {
  it("strips only the requested characters from the end", () => {
    expect(trimEndChars("http://x///", "/")).toBe("http://x");
    expect(trimEndChars("a-b--", "-")).toBe("a-b");
    expect(trimEndChars("///", "/")).toBe("");
    expect(trimEndChars("", "/")).toBe("");
    expect(trimEndChars("abc", "/")).toBe("abc");
  });

  it("strips only the requested characters from the start", () => {
    expect(trimStartChars("//a/", "/")).toBe("a/");
    expect(trimStartChars("---", "-")).toBe("");
  });

  it("strips both ends and keeps the middle", () => {
    expect(trimChars("--a-b--", "-")).toBe("a-b");
    expect(trimChars("-/a/b/-", "-/")).toBe("a/b");
    expect(trimChars("\"'x'\"", "\"'`")).toBe("x");
  });

  it("is linear on a long run of the stripped character", () => {
    const started = Date.now();
    expect(trimChars(`${"-".repeat(200_000)}x${"-".repeat(200_000)}y`, "-")).toBe(
      `x${"-".repeat(200_000)}y`,
    );
    expect(Date.now() - started).toBeLessThan(500);
  });
});
