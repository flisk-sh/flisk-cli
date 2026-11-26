// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  CacheEntry,
  CacheOptions,
  MasterConfigFileName,
  PackageInfo,
  PortAssignableResourceType,
} from "../shared.js";
import { isMasterConfigFileName } from "../shared.js";

describe("shared utility types", () => {
  it("shapes a cache entry and its options", () => {
    const options: CacheOptions = { ttlMs: 5000 };
    const entry: CacheEntry<string[]> = { value: ["api"], timestamp: 1_700_000_000_000 };
    expect(options.ttlMs).toBe(5000);
    expect(entry.value).toEqual(["api"]);
  });

  it("shapes package info with the parsed package.json", () => {
    const info: PackageInfo = {
      name: "flisk",
      version: "1.0.0",
      fullPackage: { name: "flisk", dependencies: { commander: "15.0.0" } },
    };
    expect(info.fullPackage.name).toBe("flisk");
  });

  it("keeps port-assignable types inside the creatable types", () => {
    const assignable: PortAssignableResourceType[] = [
      "backend",
      "frontend",
      "worker",
      "mcp",
      "agent",
      "bring-your-own",
    ];
    expect(assignable).toHaveLength(6);
  });

  it("validates the master config file names", () => {
    const names: MasterConfigFileName[] = [
      "TILT_TECH_STACK.star",
      "TILT_RESOURCE_DEFAULTS.star",
      "spec.master",
    ];
    for (const name of names) {
      expect(isMasterConfigFileName(name)).toBe(true);
    }
    expect(isMasterConfigFileName("Tiltfile")).toBe(false);
    expect(isMasterConfigFileName("")).toBe(false);
  });
});
