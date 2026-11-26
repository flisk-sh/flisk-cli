// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { downCommand } from "../down.js";

describe("down command module contract", () => {
  it("publishes the down command", () => {
    expect(typeof downCommand.parseAsync).toBe("function");
  });
});
