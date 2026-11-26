// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  CREATABLE_RESOURCE_TYPES,
  describe,
  expect,
  FliskError,
  isCreatableResourceType,
  isResourceCreateType,
  it,
  KEBAB_CASE_REGEX,
  parseResourceType,
  RESOURCE_CREATE_TYPE_VALUES,
} from "./test-support.js";

describe("resource name validation", () => {
  it("should accept valid kebab-case names using KEBAB_CASE_REGEX", () => {
    const validNames = ["my-service", "service123", "api-gateway", "a", "test-123-abc"];

    for (const name of validNames) {
      expect(KEBAB_CASE_REGEX.test(name)).toBe(true);
    }
  });

  it("should reject invalid names using KEBAB_CASE_REGEX", () => {
    const invalidNames = [
      "MyService", // camelCase
      "my_service", // underscore
      "my service", // space
      "service.name", // dot
      "Service-Name", // uppercase
      "", // empty
    ];

    for (const name of invalidNames) {
      expect(KEBAB_CASE_REGEX.test(name)).toBe(false);
    }
  });
});

describe("resource type validation", () => {
  it("should only accept valid resource types via isCreatableResourceType", () => {
    const validTypes = ["backend", "frontend", "worker", "mcp", "bring-your-own"];
    const invalidTypes = ["api", "microservice", "service", "app", "library", "sdk"];

    for (const type of validTypes) {
      expect(isCreatableResourceType(type)).toBe(true);
    }

    for (const type of invalidTypes) {
      expect(isCreatableResourceType(type)).toBe(false);
    }
  });

  it("should have correct CREATABLE_RESOURCE_TYPES", () => {
    expect(CREATABLE_RESOURCE_TYPES).toContain("backend");
    expect(CREATABLE_RESOURCE_TYPES).toContain("frontend");
    expect(CREATABLE_RESOURCE_TYPES).toContain("worker");
    expect(CREATABLE_RESOURCE_TYPES).toContain("mcp");
    expect(CREATABLE_RESOURCE_TYPES).toContain("agent");
    expect(CREATABLE_RESOURCE_TYPES).toContain("bring-your-own");
    expect(CREATABLE_RESOURCE_TYPES).toHaveLength(6);
  });
});

describe("parseResourceType", () => {
  it("accepts every creatable type, sdk and the byo alias", () => {
    for (const type of [...CREATABLE_RESOURCE_TYPES, "sdk"]) {
      expect(parseResourceType(type)).toBe(type);
    }
    expect(parseResourceType("byo")).toBe("bring-your-own");
  });

  it("accepts every type in the creation list the MCP resource_create tool offers", () => {
    expect(RESOURCE_CREATE_TYPE_VALUES).toContain("inference");
    expect(RESOURCE_CREATE_TYPE_VALUES).not.toContain("sdk");
    for (const type of RESOURCE_CREATE_TYPE_VALUES) {
      expect(() => parseResourceType(type), type).not.toThrow();
    }
    expect(() => parseResourceType("bogus")).toThrow(
      new RegExp(`Supported types: ${[...RESOURCE_CREATE_TYPE_VALUES, "sdk"].join(", ")}\\.`),
    );
  });

  it("keeps the creation hint helper aligned with resource type validation", () => {
    for (const type of [...RESOURCE_CREATE_TYPE_VALUES, "sdk", "byo"]) {
      expect(isResourceCreateType(type), type).toBe(true);
      expect(() => parseResourceType(type), type).not.toThrow();
    }
    for (const type of ["library", "migrator"]) {
      expect(isResourceCreateType(type), type).toBe(false);
      expect(() => parseResourceType(type), type).toThrow();
    }
  });

  it("rejects an unknown type with the supported list instead of prompting", () => {
    expect(() => parseResourceType("bogus")).toThrow(FliskError);
    expect(() => parseResourceType("bogus")).toThrow(
      /Unknown resource type "bogus"\. Supported types: backend, frontend/,
    );
    expect(() => parseResourceType("")).toThrow(/Unknown resource type/);
  });
  it("explains how to create a migrator instead of calling it an unknown type", () => {
    let error: unknown;
    try {
      parseResourceType("migrator");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FliskError);
    const { message, suggestions } = error as FliskError;
    expect(message).not.toContain("Unknown resource type");
    expect(suggestions.join("\n")).toContain("new API");
    expect(suggestions.join("\n")).toContain("--feature prisma");
    expect(suggestions.join("\n")).toContain("--type bring-your-own");
    expect(suggestions.join("\n")).toContain("--restart no");
    expect(suggestions.join("\n")).toContain("--path");
  });
});
