// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  checkCoreVersion,
  isVersionAtLeast,
  MIN_CORE_VERSION,
  RECOMMENDED_CORE_VERSION,
} from "../version-gate.js";

describe("import core version gate", () => {
  it.each([
    [MIN_CORE_VERSION, true],
    ["1.3.104", true],
    ["1.3.105", true],
    ["1.4.10", true],
    ["2.0.0", true],
    ["1.3.103", false],
    ["1.2.99", false],
    ["1.3.104-rc.1", false],
    ["not-a-version", false],
  ])("isVersionAtLeast(%s, MIN_CORE_VERSION) === %s", (version, expected) => {
    expect(isVersionAtLeast(version, MIN_CORE_VERSION)).toBe(expected);
  });

  it("recommends a core at least as new as the minimum", () => {
    expect(isVersionAtLeast(RECOMMENDED_CORE_VERSION, MIN_CORE_VERSION)).toBe(true);
  });

  it("allows a write once the core meets the floor", () => {
    expect(checkCoreVersion("1.4.10", [".", "--yes"])).toEqual({ ok: true });
  });

  it("refuses a write on an older core with the exact upgrade guidance", () => {
    expect(checkCoreVersion("1.3.100", [".", "--yes"])).toEqual({
      ok: false,
      message:
        "flisk import: installed Flisk core (1.3.100) is older than the required 1.3.104 (buildContext release). Upgrade with: flisk upgrade",
    });
  });

  it.each([["--dry-run"], ["--help"], ["-h"]])(
    "permits %s on an older core because nothing is written",
    (flag) => {
      expect(checkCoreVersion("1.3.100", [".", flag])).toEqual({ ok: true });
    },
  );
});
