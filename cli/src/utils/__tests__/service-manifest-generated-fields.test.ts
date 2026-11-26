// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_MANIFEST_SCHEMA_VERSION } from "../service-manifest.js";
import { generatedFieldErrorsForFile } from "../service-manifest-generated-fields.js";

function manifestBase(): Record<string, unknown> {
  return {
    appName: "api",
    appType: "backend",
    stack: "shop",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
  };
}

describe("generatedFieldErrorsForFile", () => {
  it("returns empty array for missing or unparseable files", () => {
    const dir = mkdtempSync(join(tmpdir(), "service-manifest-file-"));
    try {
      expect(generatedFieldErrorsForFile(join(dir, "missing.json"), "missing.json")).toEqual([]);

      const broken = join(dir, "broken.json");
      writeFileSync(broken, "not json");
      expect(generatedFieldErrorsForFile(broken, "broken.json")).toEqual([]);

      const arrayJson = join(dir, "array.json");
      writeFileSync(arrayJson, "[1, 2, 3]");
      expect(generatedFieldErrorsForFile(arrayJson, "array.json")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns errors for files with hostile values", () => {
    const dir = mkdtempSync(join(tmpdir(), "service-manifest-file-"));
    try {
      const hostileFile = join(dir, "hostile.json");
      writeFileSync(
        hostileFile,
        JSON.stringify({ ...manifestBase(), healthCheckPath: "/health\ninjection: true" }),
      );
      const errors = generatedFieldErrorsForFile(hostileFile, "hostile.json");
      expect(errors).toContain(
        "hostile.json.healthCheckPath: must be a path such as /health (no spaces, line breaks or YAML syntax)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
