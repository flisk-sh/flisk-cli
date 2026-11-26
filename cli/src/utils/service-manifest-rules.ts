// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The TypeScript half of the service.json validation rule table (#4858): the bounds and whitelists
 * validators enforce, named once per language. Its Starlark twin is runtime/discovery/validation_rules.star,
 * and tests/fixtures/service-manifest-corpus/decisions.json pins both tables plus the accept/reject
 * decisions of every validator — update all three together when a rule changes.
 *
 * Two kinds of ranges live here: the validation bands (`PORT_RANGES`, mirrored from
 * TILT_DISCOVERY.star and used to judge a manifest's port) and the allocation bands
 * (`ALLOCATION_PORT_BANDS`, the free-port pools `flisk resource` assigns from). They are different
 * tables on purpose: validation accepts a wider window than scaffolding allocates.
 */

/** `appName` length bounds (service-schema.json minLength/maxLength). */
export const APP_NAME_MIN_LENGTH = 2;
export const APP_NAME_MAX_LENGTH = 64;

/**
 * Every appType the discovery validators accept: the service-schema.json enum plus the engine's
 * internal "infra" resource type (the discovery rule predates the schema's narrower enum). The CLI's
 * own resource-config enum is narrower again (no "infra") and lives in types/index.ts.
 */
export const VALID_APP_TYPES = [
  "frontend",
  "backend",
  "library",
  "migrator",
  "sdk",
  "worker",
  "infra",
  "database",
  "mcp",
  "bring-your-own",
  "agent",
] as const;

/** appTypes that legitimately run without a port (see PORT_OPTIONAL_APP_TYPES in validation_rules.star). */
export const PORT_OPTIONAL_APP_TYPES = ["infra", "database"] as const;

/** The absolute bounds any port must satisfy (schema port minimum/maximum). */
export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/** A scaffolded (container) service's dev port window in discovery. */
export const STANDARD_PORT_MIN = 3000;
export const STANDARD_PORT_MAX = 9999;

/**
 * A bring-your-own port is the port its own container listens on — Traefik reaches it on the stack
 * network and nothing is published on the host — so an imported Compose app keeps 80, 3000 or 5432.
 */
export const BRING_YOUR_OWN_PORT_MIN = 1;
export const BRING_YOUR_OWN_PORT_MAX = 65535;

/**
 * Per-appType port bands the discovery validator judges a manifest's port against. Mirrors
 * TILT_DISCOVERY.star's PORT_RANGES (re-exported by validation_rules.star) — update both together.
 */
export const PORT_RANGES = {
  frontend: { min: 3000, max: 5999 },
  backend: { min: 4000, max: 5999 },
  worker: { min: 4000, max: 6999 },
  migrator: { min: 7000, max: 7999 },
  sdk: { min: 3000, max: 9999 },
  library: { min: 3000, max: 9999 },
} as const;

/** The discovery whitelist for a resource's `featuresEnabled` entries (TILT_DISCOVERY.star's VALID_RESOURCE_FEATURES). */
export const VALID_RESOURCE_FEATURES = [
  "api-client",
  "env-config",
  "api-index",
  "prisma",
  "nats",
  "redis",
  "infisical",
  "vitest",
  "traefik",
  "websocket",
  "graphql",
  "grpc",
  "vite-node",
  "maintenance",
  "ddd",
] as const;

/** The free-port pools `flisk resource` allocates from. constants.ts derives its PORT_RANGES shape from this table. */
export const ALLOCATION_PORT_BANDS = {
  frontend: { min: 3000, max: 3999 },
  backend: { min: 4000, max: 4999 },
  mcp: { min: 4000, max: 5999 },
  agent: { min: 4000, max: 5999 },
  "bring-your-own": { min: 4000, max: 5999 },
  worker: { min: 6000, max: 6999 },
  health: { min: 5000, max: 5999 },
  migrator: { min: 7000, max: 7999 },
} as const;

export const REPLICAS_MIN = 1;
export const REPLICAS_MAX = 10;

/** The whole table as one value, mirroring SERVICE_MANIFEST_RULES in validation_rules.star for the corpus test. */
export const SERVICE_MANIFEST_RULES = {
  appName: { minLength: APP_NAME_MIN_LENGTH, maxLength: APP_NAME_MAX_LENGTH },
  appTypes: VALID_APP_TYPES,
  portOptionalAppTypes: PORT_OPTIONAL_APP_TYPES,
  port: {
    standard: { min: STANDARD_PORT_MIN, max: STANDARD_PORT_MAX },
    bringYourOwn: { min: BRING_YOUR_OWN_PORT_MIN, max: BRING_YOUR_OWN_PORT_MAX },
    bands: PORT_RANGES,
  },
  featuresEnabled: VALID_RESOURCE_FEATURES,
  replicas: { min: REPLICAS_MIN, max: REPLICAS_MAX },
} as const;
