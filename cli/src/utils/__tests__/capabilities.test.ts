// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CAPABILITIES } from "../../config/platform-standards.js";
import {
  assertGatewayOptOutIsConfigured,
  getEnabledCapabilities,
  isDatabaseCapabilityEnabled,
  isGatewayEnabled,
  resolveProjectCapabilities,
} from "../capabilities.js";
import { FliskError } from "../errors.js";

function makeTempProject(config: Record<string, unknown>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "flisk-test-caps-"));
  const fliskDir = join(root, ".flisk");
  mkdirSync(fliskDir, { recursive: true });
  writeFileSync(join(fliskDir, "project.json"), JSON.stringify(config, null, 2), "utf-8");
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("resolveProjectCapabilities", () => {
  it("turns every capability on when there is no config and no options", () => {
    expect(resolveProjectCapabilities({})).toEqual(DEFAULT_CAPABILITIES);
    expect(resolveProjectCapabilities({ capabilities: {} })).toEqual({
      gateway: true,
      database: true,
      watch: true,
    });
  });

  it("turns the gateway off for a config object with capabilities.gateway false", () => {
    const caps = resolveProjectCapabilities({ capabilities: { gateway: false } });
    expect(caps.gateway).toBe(false);
    // Only the opted-out capability goes off; the rest keep their defaults.
    expect(caps.database).toBe(true);
  });

  it("turns the gateway off for a flag-style object source", () => {
    expect(resolveProjectCapabilities({ gateway: false }).gateway).toBe(false);
    expect(resolveProjectCapabilities({ database: false }).database).toBe(false);
  });

  it("turns a capability off through the options flags too", () => {
    expect(resolveProjectCapabilities({}, { gateway: false }).gateway).toBe(false);
    expect(resolveProjectCapabilities({}, { capabilities: { gateway: false } }).gateway).toBe(
      false,
    );
  });

  it("ignores flag-style keys that are not capabilities", () => {
    // `--no-ping` is not a capability, so the flag cannot add one to the resolved map.
    const caps = resolveProjectCapabilities({}, { ping: false });
    expect("ping" in caps).toBe(false);
    expect(caps.gateway).toBe(true);
  });

  it("a flag true never turns back on a capability the project opted out of", () => {
    // Commander sets database: true whenever --no-database is absent, and the same for --no-gateway.
    expect(
      resolveProjectCapabilities({ capabilities: { database: false } }, { database: true })
        .database,
    ).toBe(false);
    expect(
      resolveProjectCapabilities(
        { capabilities: { database: false } },
        { capabilities: { database: true } },
      ).database,
    ).toBe(false);
    expect(
      resolveProjectCapabilities({ capabilities: { gateway: false } }, { gateway: true }).gateway,
    ).toBe(false);
  });
});

describe("isGatewayEnabled", () => {
  it("is on by default", () => {
    expect(isGatewayEnabled({})).toBe(true);
    expect(isGatewayEnabled({ capabilities: { gateway: true } })).toBe(true);
  });

  it("is off when the config or an object source opts out", () => {
    expect(isGatewayEnabled({ capabilities: { gateway: false } })).toBe(false);
    expect(isGatewayEnabled({ gateway: false })).toBe(false);
  });

  it("is off when a flag opts out, and stays off when a flag default reads true", () => {
    expect(isGatewayEnabled({}, { gateway: false })).toBe(false);
    expect(isGatewayEnabled({ capabilities: { gateway: false } }, { gateway: true })).toBe(false);
    // The --no-database flag behaves the same way for the shared Postgres.
    expect(
      isDatabaseCapabilityEnabled({ capabilities: { database: false } }, { database: true }),
    ).toBe(false);
  });
});

describe("getEnabledCapabilities", () => {
  it("returns only the names that are true", () => {
    expect(getEnabledCapabilities({})).toEqual(Object.keys(DEFAULT_CAPABILITIES));
    expect(getEnabledCapabilities({ capabilities: { gateway: false } })).toEqual([
      "database",
      "watch",
    ]);
    expect(getEnabledCapabilities({ capabilities: { gateway: false, database: false } })).toEqual([
      "watch",
    ]);
    expect(getEnabledCapabilities({ database: false })).toEqual(["gateway", "watch"]);
  });
});

describe("assertGatewayOptOutIsConfigured", () => {
  it("throws a FliskError when the project still has the gateway on", () => {
    const { root, cleanup } = makeTempProject({
      version: "1.0",
      project: { name: "gw-on", version: "1.0.0" },
    });
    try {
      expect(() => assertGatewayOptOutIsConfigured(root)).toThrow(FliskError);
      expect(() => assertGatewayOptOutIsConfigured(root)).toThrow(/project\.json/);
      // No project at all counts as "the gateway is still on".
      expect(() => assertGatewayOptOutIsConfigured(null)).toThrow(FliskError);
      expect(() => assertGatewayOptOutIsConfigured(undefined)).toThrow(FliskError);
    } finally {
      cleanup();
    }
  });

  it("does not throw once project.json sets capabilities.gateway to false", () => {
    const { root, cleanup } = makeTempProject({
      version: "1.0",
      project: { name: "gw-off", version: "1.0.0" },
      capabilities: { gateway: false },
    });
    try {
      expect(() => assertGatewayOptOutIsConfigured(root)).not.toThrow();
    } finally {
      cleanup();
    }
  });
});
