// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync } from "node:fs";
import { CONTAINER_WORD_FIELD } from "./service-manifest-container.js";
import { HEALTH_PATH_PATTERN } from "./service-manifest-health.js";
import { hasLineBreakOrControl } from "./service-manifest-shared.js";

/**
 * A frontend's `basePath`, as in the schema (runtime/engine/schemas/service-schema.json). `flisk resource --base-path` checks
 * the same pattern, so a resource it creates is never reported invalid by `flisk config verify`.
 */
export const BASE_PATH_PATTERN = /^\/[a-z0-9/-]*$/;

/**
 * String fields written into the generated Docker Compose, Traefik and NATS config as they are. A newline or YAML syntax in one of
 * them adds keys to the generated service (GHSA-phgf-pww4-7jxc), so each must match its pattern. Empty values are treated as unset.
 * `tilt up` reads service.json without this CLI, so engine/topologies/tilt/manifest/parser.star enforces the same rules.
 */
const GENERATED_STRING_FIELDS: ReadonlyArray<{
  path: readonly string[];
  pattern: RegExp;
  expected: string;
}> = [
  { path: ["healthCheckPath"], pattern: HEALTH_PATH_PATTERN, expected: "a path such as /health" },
  {
    path: ["healthCheck", "path"],
    pattern: HEALTH_PATH_PATTERN,
    expected: "a path such as /health",
  },
  { path: ["apiPath"], pattern: /^\/[A-Za-z0-9._~/-]*$/, expected: "a path such as /api/v1" },
  { path: ["apiBasePath"], pattern: /^\/[A-Za-z0-9._~/-]*$/, expected: "a path such as /api/v1" },
  {
    path: ["traefik", "host"],
    pattern: /^[A-Za-z0-9.-]+$/,
    expected: "a hostname such as shop.backend.myproject.local",
  },
  {
    path: ["traefik", "pathPrefix"],
    pattern: /^\/[a-z0-9/-]*$/,
    expected: "a path such as /api/v1/shop-management",
  },
  {
    path: ["traefik", "healthCheck"],
    pattern: /^\/[a-z0-9/-]*$/,
    expected: "a path such as /health",
  },
  {
    path: ["nats", "queueGroup"],
    pattern: /^[A-Za-z0-9_.-]+$/,
    expected: "letters, digits, '_', '.' or '-'",
  },
  { path: ["databaseName"], pattern: /^[A-Za-z0-9_-]+$/, expected: "letters, digits, '_' or '-'" },
  { path: ["stack"], pattern: /^[A-Za-z0-9_-]+$/, expected: "letters, digits, '_' or '-'" },
  {
    path: ["image"],
    // Compose variables are allowed (postgres:${POSTGRES_VERSION:-18}-alpine); Compose fills them in from the project .env.
    // Mirrors image_reference_ok in engine/.../tilt/manifest/parser.star.
    // `${NAME:?message}` / `${NAME?message}` stop Compose with the message when NAME is unset (any-sync's garage image).
    // The message is printable ASCII without quotes, backslash, braces, `$` or backtick (IMAGE_MESSAGE_CHARS in parser.star).
    pattern:
      /^(?:[A-Za-z0-9._/:@-]|\$\{[A-Za-z_][A-Za-z0-9_]*(?::?-[A-Za-z0-9._/:@-]+|:?\?[A-Za-z0-9 !#%&()*+,./:;<=>?@[\]^_|~-]*)?\})+$/,
    expected:
      "an image reference such as ghcr.io/acme/app:1.0, with variables written as ${NAME}, ${NAME:-default}, ${NAME-default} or ${NAME:?message}",
  },
  { path: ["basePath"], pattern: BASE_PATH_PATTERN, expected: "a path such as /storefront" },
];

/**
 * Errors for generated-output fields whose values could change the generated YAML. The value itself is not echoed, because it may
 * contain the newline that makes it dangerous.
 */
export function validateGeneratedStringFields(
  manifest: Record<string, unknown>,
  displayPath: string,
): string[] {
  const errors: string[] = [];
  const reportedFields = new Set<string>();
  for (const { path, pattern, expected } of GENERATED_STRING_FIELDS) {
    let value: unknown = manifest;
    for (const key of path) {
      value =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)[key]
          : undefined;
    }
    if (value === undefined || value === null || value === "") continue;
    const field = `${displayPath}.${path.join(".")}`;
    if (typeof value !== "string" || !pattern.test(value)) reportedFields.add(field);
    if (typeof value !== "string") {
      errors.push(`${field}: expected a string`);
    } else if (!pattern.test(value)) {
      errors.push(`${field}: must be ${expected} (no spaces, line breaks or YAML syntax)`);
    }
  }
  for (const [field, message] of lineBreakErrors(manifest, displayPath)) {
    if (!reportedFields.has(field)) errors.push(`${field}: ${message}`);
  }
  return errors;
}

/**
 * Many more service.json values than GENERATED_STRING_FIELDS reach the generated YAML (port, appName, dockerfile, buildContext,
 * basePath, envVars, ...). A key can only be added through a line break, so no string key or value may contain one. `smoke` is
 * skipped: the CLI sends it over HTTP and it is never written into generated config.
 */
function lineBreakErrors(
  manifest: Record<string, unknown>,
  displayPath: string,
): Array<[string, string]> {
  const errors: Array<[string, string]> = [];
  const pending: Array<[unknown, string]> = Object.entries(manifest)
    .filter(([key]) => key !== "smoke")
    .map(([key, value]) => [value, `${displayPath}.${key}`]);
  for (const key of Object.keys(manifest)) {
    if (hasLineBreakOrControl(key)) errors.push([displayPath, "a key contains a line break"]);
  }
  while (pending.length > 0) {
    const [value, field] = pending.pop() as [unknown, string];
    if (typeof value === "string") {
      if (hasLineBreakOrControl(value) && !CONTAINER_WORD_FIELD.test(field)) {
        errors.push([field, "must not contain line breaks or control characters"]);
      }
    } else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) pending.push([item, `${field}[${index}]`]);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (hasLineBreakOrControl(key)) {
          errors.push([field, "a key contains a line break"]);
        } else {
          pending.push([item, `${field}.${key}`]);
        }
      }
    }
  }
  return errors.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Generated-output errors for one service.json. A file that cannot be read or parsed returns none here, because
 * validateServiceManifestFile reports that case.
 */
export function generatedFieldErrorsForFile(filePath: string, displayPath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return validateGeneratedStringFields(parsed as Record<string, unknown>, displayPath);
  } catch {
    return [];
  }
}
