// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { compareSemver, parseSemver } from "../semver.js";

describe("parseSemver", () => {
  it.each([
    ["1.2.3", { major: 1, minor: 2, patch: 3, prerelease: [] }],
    ["v1.2.3", { major: 1, minor: 2, patch: 3, prerelease: [] }],
    ["0.0.1", { major: 0, minor: 0, patch: 1, prerelease: [] }],
    ["1.2.3-alpha", { major: 1, minor: 2, patch: 3, prerelease: ["alpha"] }],
    ["1.2.3-alpha.2.1", { major: 1, minor: 2, patch: 3, prerelease: ["alpha", 2, 1] }],
    ["1.2.3+build.7", { major: 1, minor: 2, patch: 3, prerelease: [] }],
    ["1.2.3-rc.1+build", { major: 1, minor: 2, patch: 3, prerelease: ["rc", 1] }],
  ])("parses %s", (raw, expected) => {
    expect(parseSemver(raw)).toEqual(expected);
  });

  it.each(["", "abc", "1.x.2", "1.2.3.4", "1.2.3-", "-1.2.3"])("rejects %s", (raw) => {
    expect(parseSemver(raw)).toBeNull();
  });
});

describe("compareSemver", () => {
  it.each([
    ["1.2.3", "1.2.3", 0],
    ["v1.2.3", "1.2.3", 0],
    ["1.2.3+build", "1.2.3", 0],
    ["2.0.0", "1.9.9", 1],
    ["1.0.0", "0.99.99", 1],
    ["1.2.4", "1.2.3", 1],
    ["1.2.3", "1.2.4", -1],
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0", "1.0.0-alpha", 1],
    ["1.0.0-alpha", "1.0.0-alpha", 0],
    ["1.0.0-alpha.1", "1.0.0-alpha", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
  ])("compareSemver(%s, %s) === %i", (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it.each([
    ["nope", "1.0.0"],
    ["1.0.0", "nope"],
    ["", "1.0.0"],
  ])("returns null when a side cannot be parsed: %s vs %s", (a, b) => {
    expect(compareSemver(a, b)).toBeNull();
  });
});
