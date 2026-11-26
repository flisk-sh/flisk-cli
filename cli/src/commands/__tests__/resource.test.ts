// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createServiceJson, parseResourceType } from "../../commands/resource.js";
import { CREATABLE_RESOURCE_TYPES } from "../../types/index.js";

describe("resource module contract", () => {
  it("publishes the creation and parsing entry points", () => {
    expect(typeof createServiceJson).toBe("function");
    expect(typeof parseResourceType).toBe("function");
    expect(CREATABLE_RESOURCE_TYPES.length).toBeGreaterThan(0);
  });
});
