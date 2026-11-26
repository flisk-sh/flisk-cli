// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { DiscoveredResource, DiscoveredStack, ProjectCapabilities } from "../types/index.js";
import {
  type CapabilitySource,
  isDatabaseCapabilityEnabled,
  isGatewayEnabled,
} from "./capabilities.js";
import { byCodeUnit } from "./compare.js";
import { toComposeProjectName } from "./compose-project-name.js";
import { DATABASE_MANAGEMENT_FEATURE } from "./constants.js";
import { sharedPostgresDatabaseName } from "./database-name.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { databaseResourceNames, namesSharedPlatformPostgres } from "./shared-platform-postgres.js";

/** Where `groupSharedPostgres` reads the database capability: the project root, or a flag such as `--no-database`. */
export interface SharedInfraOptions {
  capabilities?: ProjectCapabilities;
  database?: boolean;
  projectRoot?: string;
}

/**
 * Groups the shared platform Postgres for `flisk status`.
 *
 * One Postgres instance serves the whole project. Each stack that uses it gets its own database named
 * `<project>_<stack>` (see #584); in a linked git worktree the name carries the checkout id from #4694 so parallel
 * checkouts never share one. `groupSharedPostgres` takes discovered stacks and does no Docker or Tilt I/O; when a
 * `projectRoot` is supplied it reads that checkout's identity. `readProjectName` is the only other file reader here.
 */

export interface SharedInfraDatabase {
  name: string;
  stack: string;
  services: string[];
}

export interface SharedPostgresInstance {
  name: "postgres";
  databases: SharedInfraDatabase[];
}

export interface SharedInfraItem {
  name: string;
  capability: string;
  description: string;
}

export const SHARED_INFRA_SERVICES = {
  traefik: {
    name: "traefik",
    capability: "gateway",
    description: "Traefik reverse proxy",
  },
  postgres: {
    name: "postgres",
    capability: "database",
    description: "PostgreSQL database",
  },
} as const;

/**
 * Returns the list of shared infrastructure service names based on enabled capabilities.
 * When gateway is disabled, Traefik is excluded.
 */
export function getSharedInfrastructureList(configOrOptions?: CapabilitySource): string[] {
  const list: string[] = [];
  if (isGatewayEnabled(configOrOptions)) {
    list.push(SHARED_INFRA_SERVICES.traefik.name);
  }
  if (isDatabaseCapabilityEnabled(configOrOptions)) {
    list.push(SHARED_INFRA_SERVICES.postgres.name);
  }
  return list;
}

/**
 * Returns detailed shared infrastructure items based on enabled capabilities.
 */
export function getSharedInfrastructureItems(
  configOrOptions?: CapabilitySource,
): SharedInfraItem[] {
  const list = getSharedInfrastructureList(configOrOptions);
  return list
    .map((name) => (SHARED_INFRA_SERVICES as Record<string, SharedInfraItem>)[name])
    .filter(Boolean);
}

/** A resource uses the shared database when its features or dependsOn ask for it. */
export function usesSharedPostgres(resource: DiscoveredResource): boolean {
  return usesSharedPostgresAmong(resource, []);
}

/**
 * Like `usesSharedPostgres`, but a dependsOn on one of `databaseNames` (the appNames of the project's `database`
 * resources, which name that same Postgres) also counts.
 */
export function usesSharedPostgresAmong(
  resource: DiscoveredResource,
  databaseNames: readonly string[],
): boolean {
  const config = resource.config;
  if (!config) return false;
  // service.json is not type-checked here, so a malformed value must not throw inside `flisk status`.
  if (
    Array.isArray(config.featuresEnabled) &&
    config.featuresEnabled.includes(DATABASE_MANAGEMENT_FEATURE)
  )
    return true;
  const dependsOn = Array.isArray(config.dependsOn) ? config.dependsOn : [];
  return dependsOn.some(
    (name) => typeof name === "string" && namesSharedPlatformPostgres(name, databaseNames),
  );
}

export function groupSharedPostgres(
  projectName: string,
  stacks: DiscoveredStack[],
  options?: SharedInfraOptions,
): SharedPostgresInstance | null {
  // A project that opted out of the shared Postgres has none to show.
  if (options && !isDatabaseCapabilityEnabled(options.projectRoot, { ...options })) return null;
  const databases: SharedInfraDatabase[] = [];

  const databaseNames = databaseResourceNames(stacks.flatMap((stack) => stack.resources));
  for (const stack of [...stacks].sort((a, b) => a.name.localeCompare(b.name))) {
    const services = stack.resources
      .filter((resource) => usesSharedPostgresAmong(resource, databaseNames))
      .map((resource) => resource.name);
    if (services.length === 0) continue;
    databases.push({
      name: sharedPostgresDatabaseName(projectName, stack.name, options?.projectRoot),
      stack: stack.name,
      services: services.sort(byCodeUnit),
    });
  }

  if (databases.length === 0) return null;
  return { name: "postgres", databases };
}

/** `project.name` from `.flisk/project.json`, or null when the project file is missing or unreadable. */
export function readProjectName(projectRoot: string): string | null {
  return readProjectNameOrUndefined(projectRoot) ?? null;
}
