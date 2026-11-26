// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { DRIFT_EXIT_CODE, formatUpSuccess, upCommand } from "../up.js";

describe("up command module contract", () => {
  it("publishes the command and success formatting entry points", () => {
    expect(typeof upCommand.parseAsync).toBe("function");
    expect(typeof formatUpSuccess).toBe("function");
    expect(Number.isInteger(DRIFT_EXIT_CODE)).toBe(true);
  });
});
