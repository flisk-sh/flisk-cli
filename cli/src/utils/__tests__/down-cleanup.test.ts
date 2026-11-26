// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as cleanup from "../down-cleanup.js";
import * as compose from "../down-compose.js";
import * as networks from "../down-networks.js";
import * as tilt from "../down-tilt.js";

describe("down-cleanup facade", () => {
  it("re-exports every runtime binding the three down-* modules define, so existing imports and mocks keep working", () => {
    for (const mod of [networks, tilt, compose]) {
      for (const [name, value] of Object.entries(mod)) {
        expect((cleanup as Record<string, unknown>)[name], name).toBe(value);
      }
    }
  });

  it("re-exports the result types", () => {
    const plan: cleanup.PruneNetworksPlan = { remove: [], keep: [] };
    const pruned: cleanup.PruneNetworksResult = { removed: [], kept: [] };
    const stopped: cleanup.ComposeFallbackResult = { stopped: [], failed: [] };
    const lookup: cleanup.NativeRunLookup = {
      roots: () => [],
      readState: () => null,
      isAlive: async () => false,
    };
    expect([plan, pruned, stopped, lookup]).toHaveLength(4);
  });

  it("still answers through the facade for each job", () => {
    expect(cleanup.projectNetworkNames("my-shop")).toContain("my_shop_backend");
    expect(cleanup.findProjectTiltUpPids("/x/Tiltfile", "win32", () => "")).toEqual([]);
    expect(cleanup.knownProjectRoots("/nonexistent-home")).toEqual([]);
  });
});
