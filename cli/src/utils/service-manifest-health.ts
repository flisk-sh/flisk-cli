// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { HealthCheckObjectConfig } from "../types/index.js";
import { isPlainObject } from "./is-plain-object.js";
import { PORT_MAX, PORT_MIN } from "./service-manifest-rules.js";

/**
 * HTTP health check path (`healthCheckPath` and `healthCheck.path`). Allows safe path characters and
 * `${VAR}` / `${VAR:-default}` references (such as `${FLISK_CHECKOUT_ID}`), while rejecting spaces,
 * quotes, line breaks, and YAML syntax. Mirrors `health_path_ok` in `runtime/engine/topologies/tilt/manifest/parser.star`.
 */
export const HEALTH_PATH_PATTERN =
  /^\/(?:[a-z0-9/-]|\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[a-z0-9/-]*)?\})*$/;

export interface ParsedHealthCheckConfig {
  enabled: boolean;
  required?: boolean;
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
  path?: string;
  onFailure?: "report" | "restart";
}

const HEALTH_CHECK_CONFIG_KEYS = new Set([
  "enabled",
  "required",
  "interval",
  "timeout",
  "startPeriod",
  "retries",
  "path",
  "port",
  "command",
  "onFailure",
]);

/**
 * Validates the optional `healthCheck` field: boolean (e.g. false to disable) or an object
 * configuring enabled, required, interval, timeout, retries, and path/port/command.
 */
export function healthCheckErrors(
  manifest: Record<string, unknown>,
  displayPath: string,
): string[] {
  const value = manifest.healthCheck;
  if (value === undefined || value === null) return [];
  if (typeof value === "boolean") return [];
  if (!isPlainObject(value)) {
    return [
      `${displayPath}.healthCheck: expected true or false, or an object such as { "enabled": true, "path": "/health" }`,
    ];
  }
  const errors: string[] = [];
  const hc = value as Record<string, unknown>;
  for (const key of Object.keys(hc)) {
    if (!HEALTH_CHECK_CONFIG_KEYS.has(key)) {
      errors.push(
        `${displayPath}.healthCheck: unexpected key "${key}" (expected "enabled", "required", "interval", "timeout", "startPeriod", "retries", "path", "port", "command", or "onFailure")`,
      );
    }
  }
  if (hc.enabled !== undefined && typeof hc.enabled !== "boolean") {
    errors.push(`${displayPath}.healthCheck.enabled: expected true or false`);
  }
  if (hc.required !== undefined && typeof hc.required !== "boolean") {
    errors.push(`${displayPath}.healthCheck.required: expected true or false`);
  }
  if (hc.interval !== undefined) {
    if (typeof hc.interval !== "number" || !Number.isFinite(hc.interval) || hc.interval <= 0) {
      errors.push(`${displayPath}.healthCheck.interval: expected a positive number`);
    }
  }
  if (hc.timeout !== undefined) {
    if (typeof hc.timeout !== "number" || !Number.isFinite(hc.timeout) || hc.timeout <= 0) {
      errors.push(`${displayPath}.healthCheck.timeout: expected a positive number`);
    }
  }
  if (hc.startPeriod !== undefined) {
    if (
      typeof hc.startPeriod !== "number" ||
      !Number.isFinite(hc.startPeriod) ||
      hc.startPeriod <= 0
    ) {
      errors.push(`${displayPath}.healthCheck.startPeriod: expected a positive number`);
    }
  }
  if (hc.retries !== undefined) {
    if (typeof hc.retries !== "number" || !Number.isInteger(hc.retries) || hc.retries < 0) {
      errors.push(`${displayPath}.healthCheck.retries: expected a non-negative integer`);
    }
  }
  if (hc.path !== undefined) {
    if (typeof hc.path !== "string") {
      errors.push(`${displayPath}.healthCheck.path: expected a string`);
    } else if (!HEALTH_PATH_PATTERN.test(hc.path)) {
      errors.push(
        `${displayPath}.healthCheck.path: must be a path such as /health (no spaces, line breaks or YAML syntax)`,
      );
    }
  }
  if (hc.port !== undefined) {
    if (
      typeof hc.port !== "number" ||
      !Number.isInteger(hc.port) ||
      hc.port < PORT_MIN ||
      hc.port > PORT_MAX
    ) {
      errors.push(
        `${displayPath}.healthCheck.port: expected a port from ${PORT_MIN} to ${PORT_MAX}`,
      );
    }
  }
  if (hc.command !== undefined) {
    if (
      !Array.isArray(hc.command) ||
      hc.command.length === 0 ||
      !hc.command.every((part) => typeof part === "string" && part.length > 0)
    ) {
      errors.push(
        `${displayPath}.healthCheck.command: expected the program and its arguments, such as ["grpc_health_probe", "-addr=:9090"]`,
      );
    }
  }
  if (hc.onFailure !== undefined && hc.onFailure !== "report" && hc.onFailure !== "restart") {
    errors.push(`${displayPath}.healthCheck.onFailure: expected "report" or "restart"`);
  }
  const probes = (["path", "port", "command"] as const).filter((key) => hc[key] !== undefined);
  if (probes.length > 1) {
    errors.push(
      `${displayPath}.healthCheck: set only one of "path", "port" or "command" (got ${probes.map((key) => `"${key}"`).join(" and ")})`,
    );
  }
  return errors;
}

/** How a service shows it is ready: an HTTP path, an open TCP port, or a command that exits 0 (#2875). */
export type ReadinessProbe =
  | { kind: "port"; port: number }
  | { kind: "command"; command: string[] };

/** A manifest, or the `config` of a discovered resource, as the health check helpers read it. */
type HealthCheckSource =
  | { healthCheck?: unknown; healthCheckPath?: unknown }
  | Readonly<Record<string, unknown>>;

/** The `healthCheck` object of a manifest, or an empty one when it is a boolean or absent. */
function healthCheckObject(manifest?: HealthCheckSource): HealthCheckObjectConfig {
  return isPlainObject(manifest?.healthCheck)
    ? (manifest.healthCheck as HealthCheckObjectConfig)
    : {};
}

/** `healthCheck.port` or `healthCheck.command`, when the service set one instead of an HTTP path. */
export function readinessProbeOf(manifest?: HealthCheckSource): ReadinessProbe | undefined {
  if (isHealthCheckDisabled(manifest)) return undefined;
  const { port, command } = healthCheckObject(manifest);
  if (typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536) {
    return { kind: "port", port };
  }
  if (
    Array.isArray(command) &&
    command.length > 0 &&
    command.every((part) => typeof part === "string")
  ) {
    return { kind: "command", command: [...command] };
  }
  return undefined;
}

/**
 * The one rule for turning health checks off: `healthCheck: false` or `healthCheck: { enabled: false }`.
 * Nothing else disables them: a service without a health path still gets its default readiness
 * signal (its port for a native `command` service, `/health` for a container).
 */
export function isHealthCheckDisabled(manifest?: HealthCheckSource): boolean {
  const value = manifest?.healthCheck;
  return value === false || (isPlainObject(value) && value.enabled === false);
}

/**
 * True when the service explicitly marks its health check as non-blocking (`healthCheck: { required: false }`).
 * Defaults to false (health checks are required). Returns false when health checks are disabled entirely.
 */
export function isHealthCheckOptional(manifest?: HealthCheckSource): boolean {
  if (isHealthCheckDisabled(manifest)) return false;
  const value = manifest?.healthCheck;
  return isPlainObject(value) && value.required === false;
}

/** The HTTP path to probe: `healthCheck.path`, then `healthCheckPath`, then `fallback`. */
export function healthCheckPathOf(
  manifest?: HealthCheckSource,
  fallback?: string,
): string | undefined {
  // A port or command probe replaces the HTTP one.
  if (readinessProbeOf(manifest)) return undefined;
  const path = healthCheckObject(manifest).path;
  if (typeof path === "string") return path;
  return typeof manifest?.healthCheckPath === "string" ? manifest.healthCheckPath : fallback;
}

/**
 * Reads a manifest's health check settings. `enabled` follows {@link isHealthCheckDisabled}; `path` follows
 * {@link healthCheckPathOf} and is absent when neither the manifest nor `options.defaultPath` gives one.
 */
export function parseHealthCheckConfig(
  manifest?: HealthCheckSource,
  options: { defaultPath?: string } = {},
): ParsedHealthCheckConfig {
  if (isHealthCheckDisabled(manifest)) return { enabled: false };
  const { required, interval, timeout, retries, startPeriod, onFailure } =
    healthCheckObject(manifest);
  const path = healthCheckPathOf(manifest, options.defaultPath);
  return {
    enabled: true,
    ...(required !== undefined ? { required } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(interval !== undefined ? { interval } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(startPeriod !== undefined ? { startPeriod } : {}),
    ...(onFailure !== undefined ? { onFailure } : {}),
  };
}
