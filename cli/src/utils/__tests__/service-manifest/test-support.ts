// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { SERVICE_MANIFEST_SCHEMA_VERSION } from "../../service-manifest.js";

export function manifestBase(): Record<string, unknown> {
  return {
    appName: "api",
    appType: "backend",
    stack: "shop",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
  };
}
