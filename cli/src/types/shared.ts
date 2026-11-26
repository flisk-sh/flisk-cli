// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { RESOURCE_DEFAULTS_FILE, TECH_STACK_FILE } from "../utils/constants.js";
import type { CreatableResourceType } from "./app-types.js";
import type { JsonObject } from "./json.js";

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export interface CacheOptions {
  ttlMs: number;
}

export interface PackageInfo {
  name: string;
  version: string;
  fullPackage: JsonObject;
}

export type PortAssignableResourceType = Extract<
  CreatableResourceType,
  "backend" | "frontend" | "worker" | "migrator" | "mcp" | "agent" | "bring-your-own"
>;

export type MasterConfigFileName =
  | typeof TECH_STACK_FILE
  | typeof RESOURCE_DEFAULTS_FILE
  | "spec.master";

/**
 * Type guard to validate filename is a known master config file.
 * Eliminates the need for 'as MasterConfigFileName' assertion.
 */
export function isMasterConfigFileName(filename: string): filename is MasterConfigFileName {
  const validNames: readonly string[] = [TECH_STACK_FILE, RESOURCE_DEFAULTS_FILE, "spec.master"];
  return validNames.includes(filename);
}
