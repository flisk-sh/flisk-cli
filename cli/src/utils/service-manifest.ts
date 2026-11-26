// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from "node:fs";
import type { DiscoveredResource } from "../types/index.js";
import { declaresCommand, validateNativeServiceFields } from "./native-service.js";
import { buildArgsErrors, envFileErrors, loggingErrors } from "./service-manifest-build-env.js";
import { configsErrors } from "./service-manifest-configs.js";
import { containerErrors } from "./service-manifest-container.js";
import {
  appTypeAndPortErrors,
  getInvalidServiceRoutePathFields,
} from "./service-manifest-core-fields.js";
import { dependsOnErrors } from "./service-manifest-depends-on.js";
import { dockerNameErrors } from "./service-manifest-docker-name.js";
import { fieldTypeErrors } from "./service-manifest-field-types.js";
import { validateGeneratedStringFields } from "./service-manifest-generated-fields.js";
import { healthCheckErrors } from "./service-manifest-health.js";
import { extraPortsErrors } from "./service-manifest-ports.js";
import {
  byoEnvErrors,
  modelsErrors,
  providersErrors,
  providesErrors,
} from "./service-manifest-providers.js";
import { restartErrors } from "./service-manifest-restart.js";
import { secretConflictWarnings, secretsErrors } from "./service-manifest-secrets.js";
import { sidecarErrors } from "./service-manifest-sidecars.js";
import { volumesErrors } from "./service-manifest-volumes.js";
import { webUiErrors } from "./service-manifest-web-ui.js";
import { validateSmoke } from "./smoke.js";
import { suggestClosest } from "./suggestions.js";
import { isReservedInfrastructureName } from "./validation.js";

export { isDockerSafeName } from "./service-manifest-docker-name.js";
export { isAbsoluteBuildPath } from "./service-manifest-field-types.js";
export {
  BASE_PATH_PATTERN,
  generatedFieldErrorsForFile,
} from "./service-manifest-generated-fields.js";
export {
  HEALTH_PATH_PATTERN,
  healthCheckPathOf,
  isHealthCheckDisabled,
  isHealthCheckOptional,
  type ParsedHealthCheckConfig,
  parseHealthCheckConfig,
  type ReadinessProbe,
  readinessProbeOf,
} from "./service-manifest-health.js";
export { type ProviderSpec, providersOf } from "./service-manifest-providers.js";
// The per-field validators live in the service-manifest-*.ts modules; re-exported for existing importers.
export {
  appTypeAndPortErrors,
  buildArgsErrors,
  byoEnvErrors,
  configsErrors,
  containerErrors,
  dependsOnErrors,
  dockerNameErrors,
  envFileErrors,
  extraPortsErrors,
  fieldTypeErrors,
  getInvalidServiceRoutePathFields,
  healthCheckErrors,
  loggingErrors,
  modelsErrors,
  providersErrors,
  providesErrors,
  restartErrors,
  secretConflictWarnings,
  secretsErrors,
  sidecarErrors,
  validateGeneratedStringFields,
  volumesErrors,
  webUiErrors,
};

export const SERVICE_MANIFEST_SCHEMA_VERSION = 1;
export const SERVICE_MANIFEST_SCHEMA_URL = "https://flisk.sh/schema.service.json";

/**
 * Fields that are still read, or still tolerated, but should not be used. The warning says what replaces each one. `jwtSecret` is
 * ignored outright: a secret must not be committed (see docs/environment.md).
 */
const DEPRECATED_FIELDS: Record<string, string> = {
  dependencies: "deprecated, use dependsOn (still read for now)",
  envVars: "deprecated, use params (still read when params is absent)",
  jwtSecret:
    "ignored. A secret must not be committed: remove it and set JWT_SECRET in the project .env",
};

const KNOWN_SERVICE_FIELDS = new Set([
  "$schema",
  "agent",
  "apiBasePath",
  "apiPath",
  "appName",
  "appType",
  "backendName",
  "basePath",
  "build",
  "buildArgs",
  "buildContext",
  "command",
  "configs",
  "container",
  "databaseName",
  "dependencies",
  "dev",
  "dependsOn",
  "dockerfile",
  "enabled",
  "env",
  "envFile",
  "exposeViaProxy",
  "extraPorts",
  "featuresEnabled",
  "framework",
  "healthCheck",
  "healthCheckPath",
  "image",
  "language",
  "logging",
  "models",
  "name",
  "nats",
  "params",
  "profiles",
  "playwright",
  "provides",
  "providers",
  "port",
  "replicas",
  "restart",
  "runtime",
  "sablier",
  "schemaVersion",
  "secrets",
  "sidecarOf",
  "smoke",
  "stack",
  "syncs",
  "toolchain",
  "traefik",
  "type",
  "volumes",
  "webUi",
]);

/** Every field a misspelled key may be a typo of: the known fields and the deprecated ones (`envVars`). */
const TYPO_CANDIDATES: readonly string[] = [
  ...KNOWN_SERVICE_FIELDS,
  ...Object.keys(DEPRECATED_FIELDS),
];

/**
 * A top-level service.json key Flisk does not read that sits within the suggestion edit distance of a
 * field it does (a `comand` for `command`, or a case-only `healthcheckpath` for `healthCheckPath`).
 * The field is ignored, so the service silently loses what the key meant.
 */
export interface ManifestFieldTypo {
  field: string;
  suggestion: string;
}

/** The near-miss unknown keys of one manifest, in file order. */
export function manifestFieldTypos(manifest: Record<string, unknown>): ManifestFieldTypo[] {
  const typos: ManifestFieldTypo[] = [];
  for (const field of Object.keys(manifest)) {
    if (KNOWN_SERVICE_FIELDS.has(field) || field in DEPRECATED_FIELDS) continue;
    const suggestion = suggestClosest(field, TYPO_CANDIDATES);
    if (suggestion !== undefined) typos.push({ field, suggestion });
  }
  return typos;
}

/**
 * One line per near-miss key across the discovered services, for an error such a key may have
 * caused: a `comand` hides `command`, so a service meant to run as a local process reads as a
 * Docker service and `flisk up` or `flisk doctor` then blames Docker instead of the typo.
 */
export function serviceManifestTypoNotes(resources: readonly DiscoveredResource[]): string[] {
  return resources.flatMap((resource) =>
    manifestFieldTypos(resource.config ?? {}).map(
      (typo) =>
        `${resource.name}'s service.json has "${typo.field}"; did you mean "${typo.suggestion}"? Flisk ignores the misspelled key.`,
    ),
  );
}

export interface ServiceManifestValidation {
  errors: string[];
  warnings: string[];
  manifest?: Record<string, unknown>;
}

// App types whose Bun image runs the `dev` script under a watcher (mirrors BUN_LIVE_RELOAD_APP_TYPES in language_dockerfile.star).
const BUN_LIVE_RELOAD_APP_TYPES = new Set(["backend", "worker", "agent", "mcp"]);

function liveReloadApplies(manifest: Record<string, unknown>): boolean {
  const language = manifest.language ?? "bun";
  if (language === "go") return true;
  return language === "bun" && BUN_LIVE_RELOAD_APP_TYPES.has(String(manifest.appType ?? "backend"));
}

/**
 * Reserved infrastructure names in an existing service.json, so `flisk config verify` says why the name is bad before
 * `flisk up` fails inside Tilt. BYO imports may deliberately use a fixed container name (the engine already avoids
 * registering a second shared Postgres for them), and a local process never reaches Tilt, so neither clashes.
 */
export function reservedInfrastructureNameErrors(
  manifest: Record<string, unknown>,
  displayPath: string,
): string[] {
  if (declaresCommand(manifest) || manifest.appType === "bring-your-own") return [];
  const appName = manifest.appName;
  if (typeof appName !== "string" || !isReservedInfrastructureName(appName)) return [];
  return [
    `${displayPath}.appName: "${appName}" is reserved for Flisk's own infrastructure: Flisk registers a fixed Tilt/Compose service with that name; pick another resource name.`,
  ];
}

export function validateServiceManifest(
  value: unknown,
  displayPath: string,
): ServiceManifestValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: [`${displayPath}: expected a JSON object`], warnings: [] };
  }

  const manifest = value as Record<string, unknown>;
  const errors: string[] = [];
  // A `command` service runs as a local process, so it has no stack to group generated output by (the minimal contract in
  // utils/native-service.ts). An `image` service is prebuilt, so like the schema it may omit `stack` too. Every other
  // service keeps the full set.
  const requiredFields =
    declaresCommand(manifest) || (typeof manifest.image === "string" && manifest.image !== "")
      ? (["appName", "appType", "schemaVersion"] as const)
      : (["appName", "appType", "stack", "schemaVersion"] as const);
  for (const field of requiredFields) {
    if (!(field in manifest)) errors.push(`${displayPath}.${field}: required field is missing`);
  }
  for (const field of ["appName", "appType", "stack"] as const) {
    if (field in manifest && typeof manifest[field] !== "string") {
      errors.push(`${displayPath}.${field}: expected a string`);
    }
  }
  errors.push(...appTypeAndPortErrors(manifest, displayPath));
  if ("schemaVersion" in manifest && manifest.schemaVersion !== SERVICE_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `${displayPath}.schemaVersion: unsupported version ${String(manifest.schemaVersion)} (supported: ${SERVICE_MANIFEST_SCHEMA_VERSION})`,
    );
  }
  for (const field of getInvalidServiceRoutePathFields(manifest)) {
    errors.push(`${displayPath}.${field}: expected a string`);
  }
  const dev = manifest.dev;
  const liveReload =
    dev && typeof dev === "object" && !Array.isArray(dev)
      ? (dev as Record<string, unknown>).liveReload
      : undefined;
  if (liveReload !== undefined && typeof liveReload !== "boolean") {
    errors.push(`${displayPath}.dev.liveReload: expected true or false`);
  }
  errors.push(...validateGeneratedStringFields(manifest, displayPath));
  errors.push(...dockerNameErrors(manifest, displayPath));
  errors.push(...reservedInfrastructureNameErrors(manifest, displayPath));
  errors.push(...fieldTypeErrors(manifest, displayPath));
  errors.push(...validateNativeServiceFields(manifest).map((error) => `${displayPath}: ${error}`));
  errors.push(...secretsErrors(manifest, displayPath));
  errors.push(...configsErrors(manifest, displayPath));
  errors.push(...containerErrors(manifest, displayPath));
  errors.push(...extraPortsErrors(manifest, displayPath));
  errors.push(...providesErrors(manifest, displayPath));
  errors.push(...providersErrors(manifest, displayPath));
  errors.push(...sidecarErrors(manifest, displayPath));
  errors.push(...volumesErrors(manifest, displayPath));
  errors.push(...envFileErrors(manifest, displayPath));
  errors.push(...modelsErrors(manifest, displayPath));
  errors.push(...restartErrors(manifest, displayPath));
  errors.push(...webUiErrors(manifest, displayPath));
  errors.push(...dependsOnErrors(manifest, displayPath));
  errors.push(...buildArgsErrors(manifest, displayPath));
  errors.push(...loggingErrors(manifest, displayPath));
  errors.push(...byoEnvErrors(manifest, displayPath));
  errors.push(...healthCheckErrors(manifest, displayPath));
  if ("profiles" in manifest) {
    const profiles = manifest.profiles;
    if (
      !Array.isArray(profiles) ||
      profiles.length === 0 ||
      !profiles.every((name) => typeof name === "string" && /^[a-z0-9][a-z0-9-]*$/.test(name))
    ) {
      errors.push(
        `${displayPath}.profiles: expected a list of profile names such as ["admin"] (lowercase letters, digits and hyphens)`,
      );
    }
  }

  if ("smoke" in manifest) {
    for (const message of validateSmoke(manifest.smoke)) errors.push(`${displayPath}.${message}`);
  }

  const warnings = Object.keys(manifest).flatMap((field) => {
    const deprecation = DEPRECATED_FIELDS[field];
    if (deprecation) return [`${displayPath}.${field}: ${deprecation}`];
    if (!KNOWN_SERVICE_FIELDS.has(field)) {
      const suggestion = suggestClosest(field, Array.from(KNOWN_SERVICE_FIELDS));
      if (suggestion) {
        return [
          `${displayPath}: unknown field "${field}"; did you mean "${suggestion}"? (ignored by Flisk, kept in the file)`,
        ];
      }
      return [`${displayPath}.${field}: unknown field is preserved`];
    }
    return [];
  });
  warnings.push(...secretConflictWarnings(manifest, displayPath));
  // Go opts in with `true`. A Bun backend, worker, agent or MCP server reloads by default (#3395), so `true` only restates that; other
  // Bun app types (frontend, bring-your-own, library, SDK) have no watcher, and any other language ignores it.
  if (liveReload === true && !liveReloadApplies(manifest)) {
    warnings.push(
      `${displayPath}.dev.liveReload: only applies to Go services and Bun backends, workers, agents and MCP servers; it is ignored here`,
    );
  }
  const testOnSave =
    dev && typeof dev === "object" && !Array.isArray(dev)
      ? (dev as Record<string, unknown>).testOnSave
      : undefined;
  const testOnSaveEnabled =
    testOnSave === true ||
    (testOnSave &&
      typeof testOnSave === "object" &&
      !Array.isArray(testOnSave) &&
      (testOnSave as Record<string, unknown>).enabled !== false);
  if (testOnSaveEnabled && manifest.language !== "python") {
    warnings.push(
      `${displayPath}.dev.testOnSave: only applies to Python services (language "python"); it is ignored here`,
    );
  }
  if (
    manifest.env &&
    typeof manifest.env === "object" &&
    Object.keys(manifest.env).length > 0 &&
    manifest.appType !== "bring-your-own" &&
    !declaresCommand(manifest)
  ) {
    warnings.push(
      `${displayPath}.env: only applies to a service that declares a "command" (a local process) or to a bring-your-own resource; it is ignored here. Use "params" for non-secret values and "secrets" for secrets`,
    );
  }
  return { errors: [...new Set(errors)], warnings, manifest };
}

export function validateServiceManifestFile(
  filePath: string,
  displayPath: string,
): ServiceManifestValidation {
  if (!existsSync(filePath)) {
    return { errors: [`${displayPath}: file is missing`], warnings: [] };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    return validateServiceManifest(parsed, displayPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { errors: [`${displayPath}: invalid JSON (${message})`], warnings: [] };
  }
}
