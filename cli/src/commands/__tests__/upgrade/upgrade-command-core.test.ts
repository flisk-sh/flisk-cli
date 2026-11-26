// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { loadUpgradeWithMocks, setupUpgradeCommandTests } from "./test-support.js";

const upgrade = await loadUpgradeWithMocks();

describe("upgradeCommand action handler", () => {
  setupUpgradeCommandTests(upgrade);

  it("configures the default export command instance", () => {
    expect(upgrade.upgradeCommand.name()).toBe("upgrade");
    expect(upgrade.upgradeCommand.aliases()).toContain("update");
  });
});
