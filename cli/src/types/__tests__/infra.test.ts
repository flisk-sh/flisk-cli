// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { CREATABLE_RESOURCE_TYPES } from "../app-types.js";
import type { InfraFramework, InfraResourceType, PresetResourceType } from "../infra.js";
import {
  DATABASE_FRAMEWORK,
  DATABASE_FRAMEWORKS,
  DATABASE_INFRA_FRAMEWORKS,
  DATABASE_RESOURCE_TYPE,
  DEFAULT_QUEUE_FRAMEWORK,
  INFERENCE_RESOURCE_TYPE,
  isResourceCreateType,
  MAIL_FRAMEWORKS,
  MAIL_RESOURCE_TYPE,
  PAYMENT_FRAMEWORKS,
  PAYMENT_RESOURCE_TYPE,
  PRESET_RESOURCE_TYPES,
  QUEUE_FRAMEWORKS,
  QUEUE_RESOURCE_TYPE,
  RESOURCE_CREATE_TYPE_VALUES,
  RESOURCE_TYPE_VALUES,
  STORAGE_FRAMEWORKS,
  STORAGE_RESOURCE_TYPE,
} from "../infra.js";

describe("infrastructure presets", () => {
  it("keys the preset table by the preset resource types", () => {
    const keys = Object.keys(PRESET_RESOURCE_TYPES);
    const typed: PresetResourceType[] = keys as PresetResourceType[];
    expect(typed).toEqual([
      QUEUE_RESOURCE_TYPE,
      STORAGE_RESOURCE_TYPE,
      MAIL_RESOURCE_TYPE,
      PAYMENT_RESOURCE_TYPE,
    ]);
  });

  it("puts the shared Postgres first among the database frameworks", () => {
    const first: InfraFramework = DATABASE_FRAMEWORKS[0] as InfraFramework;
    expect(first).toBe(DATABASE_FRAMEWORK);
    expect(DATABASE_FRAMEWORKS).toEqual([DATABASE_FRAMEWORK, ...DATABASE_INFRA_FRAMEWORKS]);
    expect(DATABASE_FRAMEWORKS).toContain("mysql");
  });

  it("gives every preset a framework list and a default it contains", () => {
    const presets: Record<PresetResourceType, readonly string[]> = {
      [QUEUE_RESOURCE_TYPE]: QUEUE_FRAMEWORKS,
      [STORAGE_RESOURCE_TYPE]: STORAGE_FRAMEWORKS,
      [MAIL_RESOURCE_TYPE]: MAIL_FRAMEWORKS,
      [PAYMENT_RESOURCE_TYPE]: PAYMENT_FRAMEWORKS,
    };
    for (const [type, preset] of Object.entries(PRESET_RESOURCE_TYPES)) {
      expect(preset.frameworks).toEqual(presets[type as PresetResourceType]);
      expect(preset.frameworks).toContain(preset.default);
    }
    expect(QUEUE_FRAMEWORKS).toContain(DEFAULT_QUEUE_FRAMEWORK);
  });

  it("covers the creatable and infrastructure types in the --type values", () => {
    const infraTypes: InfraResourceType[] = [
      DATABASE_RESOURCE_TYPE,
      QUEUE_RESOURCE_TYPE,
      STORAGE_RESOURCE_TYPE,
      MAIL_RESOURCE_TYPE,
      PAYMENT_RESOURCE_TYPE,
    ];
    for (const type of [...CREATABLE_RESOURCE_TYPES, ...infraTypes, "sdk"]) {
      expect(RESOURCE_TYPE_VALUES).toContain(type);
    }
    // Scaffolding a new resource drops "sdk" (register-only) and adds the inference preset.
    expect(RESOURCE_CREATE_TYPE_VALUES).not.toContain("sdk");
    expect(RESOURCE_CREATE_TYPE_VALUES).not.toContain("byo");
    expect(RESOURCE_CREATE_TYPE_VALUES).toContain(INFERENCE_RESOURCE_TYPE);
    for (const type of [...CREATABLE_RESOURCE_TYPES, ...infraTypes]) {
      expect(RESOURCE_CREATE_TYPE_VALUES).toContain(type);
    }
  });

  it("isResourceCreateType accepts the listed values plus the sdk and byo aliases", () => {
    expect(isResourceCreateType("backend")).toBe(true);
    expect(isResourceCreateType(INFERENCE_RESOURCE_TYPE)).toBe(true);
    expect(isResourceCreateType("sdk")).toBe(true);
    expect(isResourceCreateType("byo")).toBe(true);
    expect(isResourceCreateType("frontend")).toBe(true);
    expect(isResourceCreateType("nonsense")).toBe(false);
  });
});
