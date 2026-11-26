// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { CreatableResourceType, ResourceType } from "../app-types.js";
import {
  CREATABLE_RESOURCE_TYPES,
  isCreatableResourceType,
  RESOURCE_CONFIG_APP_TYPES,
} from "../app-types.js";

describe("app type vocabulary", () => {
  it("lists every ResourceType in the service.json appType enum", () => {
    const types: ResourceType[] = [...RESOURCE_CONFIG_APP_TYPES];
    for (const type of RESOURCE_CONFIG_APP_TYPES) {
      expect(types).toContain(type);
    }
    expect(new Set(types)).toEqual(new Set(RESOURCE_CONFIG_APP_TYPES));
  });

  it("keeps the creatable types a subset of the app types", () => {
    for (const type of CREATABLE_RESOURCE_TYPES) {
      const typed: CreatableResourceType = type;
      expect(RESOURCE_CONFIG_APP_TYPES).toContain(typed);
    }
  });

  it("isCreatableResourceType accepts creatable types only", () => {
    expect(isCreatableResourceType("backend")).toBe(true);
    expect(isCreatableResourceType("database")).toBe(false);
    expect(isCreatableResourceType("sdk")).toBe(false);
    expect(isCreatableResourceType(42)).toBe(false);
  });
});
