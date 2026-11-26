// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export const RESOURCE_CONFIG_APP_TYPES = [
  "backend",
  "frontend",
  "library",
  "sdk",
  "worker",
  "migrator",
  "mcp",
  "agent",
  "database",
  "bring-your-own",
] as const;

export type ResourceType =
  | "frontend"
  | "backend"
  | "library"
  | "sdk"
  | "worker"
  | "migrator"
  | "mcp"
  | "agent"
  | "database"
  | "bring-your-own";

export const CREATABLE_RESOURCE_TYPES = [
  "backend",
  "frontend",
  "worker",
  "mcp",
  "agent",
  "bring-your-own",
] as const;

export type CreatableResourceType = Extract<
  ResourceType,
  (typeof CREATABLE_RESOURCE_TYPES)[number]
>;

export function isCreatableResourceType(value: unknown): value is CreatableResourceType {
  return (
    typeof value === "string" && (CREATABLE_RESOURCE_TYPES as readonly string[]).includes(value)
  );
}
