// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { withManifestTypos } from "../doctor-container.js";

const failing = { name: "Colima", didPass: false, message: "The Colima VM is not running" };
const note =
  'api\'s service.json has "comand"; did you mean "command"? Flisk ignores the misspelled key.';

describe("withManifestTypos", () => {
  it("names the near-miss service.json keys in a failing check's message", () => {
    expect(withManifestTypos(failing, [note])).toEqual({
      name: "Colima",
      didPass: false,
      message: `The Colima VM is not running\n  ${note}`,
    });
  });

  it("keeps the fix and leaves a passing or typo-free check untouched", () => {
    const withFix = { ...failing, fix: "colima start" };
    expect(withManifestTypos(withFix, [note]).fix).toBe("colima start");
    expect(withManifestTypos({ ...failing, didPass: true }, [note]).message).toBe(failing.message);
    expect(withManifestTypos(failing, [])).toBe(failing);
  });
});
