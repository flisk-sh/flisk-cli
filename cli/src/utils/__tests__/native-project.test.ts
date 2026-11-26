// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearDiscoveryCache } from "../discovery-context.js";
import { findNativeProject, hasNearbyServiceJson } from "../native-project.js";

function writeServiceJson(dir: string, manifest: Record<string, unknown> = {}): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "service.json"), JSON.stringify(manifest));
}

describe("hasNearbyServiceJson", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flisk-native-project-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("is true for a service.json in the folder itself", () => {
    writeServiceJson(root);
    expect(hasNearbyServiceJson(root)).toBe(true);
  });

  it("is true for a service.json one level down", () => {
    writeServiceJson(join(root, "api"));
    expect(hasNearbyServiceJson(root)).toBe(true);
  });

  it("is true for a service.json two levels down", () => {
    writeServiceJson(join(root, "services", "api"));
    expect(hasNearbyServiceJson(root)).toBe(true);
  });

  it("is false for a service.json three levels down", () => {
    writeServiceJson(join(root, "a", "b", "c"));
    expect(hasNearbyServiceJson(root)).toBe(false);
  });

  it("ignores service.json in dot-folders and node_modules", () => {
    writeServiceJson(join(root, ".hidden"));
    writeServiceJson(join(root, "nested", "node_modules"));
    expect(hasNearbyServiceJson(root)).toBe(false);
  });

  it("is false for a folder that does not exist", () => {
    expect(hasNearbyServiceJson(join(root, "missing"))).toBe(false);
  });
});

describe("findNativeProject", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "flisk-native-project-"));
    clearDiscoveryCache();
  });

  afterEach(() => {
    clearDiscoveryCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns null outside any project", () => {
    expect(findNativeProject(root)).toBeNull();
  });

  it("returns null when a service has no command", () => {
    writeServiceJson(join(root, "api"), { appName: "api", appType: "backend" });
    writeServiceJson(join(root, "web"), {
      appName: "web",
      appType: "frontend",
      command: "node server.js",
    });
    expect(findNativeProject(root)).toBeNull();
  });

  it("returns the project root and resources when every service declares command", () => {
    writeServiceJson(join(root, "api"), {
      appName: "api",
      appType: "backend",
      command: "node server.js",
    });
    const result = findNativeProject(root);
    expect(result?.projectRoot).toBe(root);
    expect(result?.resources.map((resource) => resource.name)).toEqual(["api"]);
  });
});
