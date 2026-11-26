// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createUpgradeCommand, parseChecksums, upgradeCommand } from "../../upgrade.js";

describe("upgrade module contract", () => {
  it("publishes the command factory and the registered command", () => {
    expect(typeof createUpgradeCommand).toBe("function");
    expect(typeof upgradeCommand.parseAsync).toBe("function");
  });

  it("publishes checksum parsing", () => {
    expect(typeof parseChecksums).toBe("function");
  });
});
