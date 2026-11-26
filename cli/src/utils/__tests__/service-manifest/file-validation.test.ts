// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dockerNameErrors,
  generatedFieldErrorsForFile,
  isDockerSafeName,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  validateServiceManifest,
  validateServiceManifestFile,
} from "../../service-manifest.js";

function manifestBase(): Record<string, unknown> {
  return {
    appName: "api",
    appType: "backend",
    stack: "shop",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
  };
}

describe("validateServiceManifestFile and generatedFieldErrorsForFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "service-manifest-file-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports missing file in validateServiceManifestFile", () => {
    const missing = join(dir, "nonexistent.json");
    expect(validateServiceManifestFile(missing, "nonexistent.json")).toEqual({
      errors: ["nonexistent.json: file is missing"],
      warnings: [],
    });
  });

  it("reports invalid JSON syntax in validateServiceManifestFile", () => {
    const invalid = join(dir, "broken.json");
    writeFileSync(invalid, "{ invalid json content");
    const result = validateServiceManifestFile(invalid, "broken.json");
    expect(result.errors[0]).toContain("broken.json: invalid JSON (");
    expect(result.warnings).toEqual([]);
  });

  it("validates a well-formed service.json file", () => {
    const file = join(dir, "service.json");
    writeFileSync(file, JSON.stringify(manifestBase()));
    const result = validateServiceManifestFile(file, "service.json");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.manifest?.appName).toBe("api");
  });

  it("generatedFieldErrorsForFile returns empty array for missing or unparseable files", () => {
    expect(generatedFieldErrorsForFile(join(dir, "missing.json"), "missing.json")).toEqual([]);

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "not json");
    expect(generatedFieldErrorsForFile(broken, "broken.json")).toEqual([]);

    const arrayJson = join(dir, "array.json");
    writeFileSync(arrayJson, "[1, 2, 3]");
    expect(generatedFieldErrorsForFile(arrayJson, "array.json")).toEqual([]);
  });

  it("generatedFieldErrorsForFile returns errors for files with hostile values", () => {
    const hostileFile = join(dir, "hostile.json");
    writeFileSync(
      hostileFile,
      JSON.stringify({ ...manifestBase(), healthCheckPath: "/health\ninjection: true" }),
    );
    const errors = generatedFieldErrorsForFile(hostileFile, "hostile.json");
    expect(errors).toContain(
      "hostile.json.healthCheckPath: must be a path such as /health (no spaces, line breaks or YAML syntax)",
    );
  });
});

describe("Docker-safe names", () => {
  it.each(["orders", "orders-api", "orders2", "back_office", "a.b", "a__b", "a".repeat(63)])(
    "accepts %j as a stack",
    (name) => expect(isDockerSafeName(name)).toBe(true),
  );
  it("limits appName to 59 characters, because Tilt labels it app.<appName> (63 bytes)", () => {
    expect(dockerNameErrors({ appName: "a".repeat(59) }, "s.json")).toEqual([]);
    expect(dockerNameErrors({ appName: "a".repeat(60) }, "s.json")).toHaveLength(1);
  });
  it.each([
    "",
    "Orders",
    "my service",
    "-x",
    "x-",
    "x--",
    ".x",
    "x/y",
    "x:y",
    "ünï",
    "a".repeat(64),
    7,
    null,
  ])("refuses %j", (name) => expect(isDockerSafeName(name)).toBe(false));
  it("reports appName and stack without echoing a long value", () => {
    const errors = dockerNameErrors(
      { appName: "A".repeat(100), stack: "Shop" },
      "svc/service.json",
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("svc/service.json.appName");
    expect(errors[0].length).toBeLessThan(260);
  });
  it("is part of validateServiceManifest, and skips a local-process service", () => {
    const base = { appType: "backend", schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION };
    expect(
      validateServiceManifest({ ...base, appName: "Orders", stack: "shop" }, "s.json").errors,
    ).toEqual([expect.stringContaining("appName")]);
    expect(
      validateServiceManifest({ ...base, appName: "Orders", command: "node x.js" }, "s.json")
        .errors,
    ).toEqual([]);
  });
});
