// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { DiscoveredResource } from "../types/index.js";
import { byCodeUnit } from "./compare.js";
import { BRING_YOUR_OWN_TYPE, DATABASE_MANAGEMENT_FEATURE } from "./constants.js";
import { dependsOnOf } from "./dependency-graph.js";
import { isNativeProject } from "./native-service.js";

/**
 * Whether the project needs Flisk's own platform services, and why (#2963). The router (Traefik) serves every routed service;
 * the shared PostgreSQL serves every `database` resource, every `dependsOn: postgres`, and every managed backend-side
 * resource. A frontend is routed but is not a database user unless it opts in. A project of only bring-your-own containers
 * that publish their own ports and bring their own database needs neither.
 */
export interface PlatformServiceNeed {
  /** True when some resource of the project uses this platform service. */
  isNeeded: boolean;
  /** The resources that use it, sorted. Empty when `isNeeded` is false. */
  users: string[];
  /** One line for `flisk status`: who needs it, or why nothing does. */
  reason: string;
}

export interface PlatformServiceNeeds {
  gateway: PlatformServiceNeed;
  database: PlatformServiceNeed;
}

const POSTGRES_NAMES: readonly string[] = ["postgres", DATABASE_MANAGEMENT_FEATURE];

function isBringYourOwn(resource: DiscoveredResource): boolean {
  return resource.config?.appType === BRING_YOUR_OWN_TYPE;
}

function wantsSharedPostgres(resource: DiscoveredResource, databaseNames: string[]): boolean {
  const features = resource.config?.featuresEnabled;
  if (Array.isArray(features) && features.includes(DATABASE_MANAGEMENT_FEATURE)) return true;
  return dependsOnOf(resource.config).some(
    (name) => POSTGRES_NAMES.includes(name) || databaseNames.includes(name),
  );
}

/**
 * What the resources need. Backends, workers, agents, migrators and MCP servers use the shared PostgreSQL. A frontend is
 * a gateway user but not a database user unless it opts in through `database-management` in `featuresEnabled` or a
 * `dependsOn` of `postgres`/`database-management`/a `database` resource. Bring-your-own resources are only gateway users
 * when routed.
 */
export function evaluatePlatformServiceNeeds(
  resources: readonly DiscoveredResource[],
): PlatformServiceNeeds {
  // A `database` resource only names the shared Postgres: it has no route and nothing else to start.
  const others = resources
    .filter((resource) => !isBringYourOwn(resource) && resource.config?.appType !== "database")
    .map((r) => r.name);
  const databaseCandidates = resources
    .filter(
      (resource) =>
        !isBringYourOwn(resource) &&
        resource.config?.appType !== "database" &&
        resource.config?.appType !== "frontend",
    )
    .map((r) => r.name);
  const routed = resources
    .filter((resource) => isBringYourOwn(resource) && resource.config?.exposeViaProxy !== false)
    .map((r) => r.name);
  const databaseNames = resources
    .filter((resource) => resource.config?.appType === "database")
    .map((r) => r.name);
  const postgresUsers = resources
    .filter(
      (resource) =>
        databaseNames.includes(resource.name) || wantsSharedPostgres(resource, databaseNames),
    )
    .map((r) => r.name);

  const gatewayUsers = [...others, ...routed].sort(byCodeUnit);
  const databaseUsers = [...new Set([...databaseCandidates, ...postgresUsers])].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    gateway: {
      isNeeded: gatewayUsers.length > 0,
      users: gatewayUsers,
      reason:
        gatewayUsers.length > 0
          ? `${gatewayUsers.length} routed ${gatewayUsers.length === 1 ? "service" : "services"}`
          : 'no routed service (every resource is bring-your-own with "exposeViaProxy": false)',
    },
    database: {
      isNeeded: databaseUsers.length > 0,
      users: databaseUsers,
      reason:
        databaseUsers.length > 0
          ? `used by ${databaseUsers.length} ${databaseUsers.length === 1 ? "resource" : "resources"}`
          : "no database resource and no dependsOn postgres",
    },
  };
}

/**
 * Whether the project's `.env` needs the database keys Flisk generates for the shared PostgreSQL: `DB_PASSWORD`, and
 * `DATABASE_URL` built from it (#3200, #3711). Two projects do not need them: one of only bring-your-own containers that do
 * not use the shared PostgreSQL, and a local-processes project (every service runs with `command`, possibly next to a
 * ready-made `image`). In a local-processes project the keys are only kept when a service really uses the shared PostgreSQL:
 * it is a `database` resource, has the `database-management` feature, or `dependsOn` Postgres.
 *
 * `JWT_SECRET` is not decided here: every Compose entry requires it (local-jwt is the default auth mode), so it is always
 * kept. Conservative like {@link evaluatePlatformServiceNeeds}: any other resource mix, or no resource at all, keeps the keys.
 */
export function needsDatabaseKeys(resources: readonly DiscoveredResource[]): boolean {
  if (resources.length === 0) return true;
  if (isNativeProject(resources)) {
    const databaseNames = resources
      .filter((resource) => resource.config?.appType === "database")
      .map((resource) => resource.name);
    return resources.some(
      (resource) =>
        databaseNames.includes(resource.name) || wantsSharedPostgres(resource, databaseNames),
    );
  }
  if (!resources.every(isBringYourOwn)) return true;
  return evaluatePlatformServiceNeeds(resources).database.isNeeded;
}
