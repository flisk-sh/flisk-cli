// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { RESOURCE_CONFIG_APP_TYPES } from "../types/index.js";
import { PORT_MAX, PORT_MIN } from "./service-manifest-rules.js";

const SERVICE_ROUTE_PATH_FIELDS = ["apiPath", "basePath"] as const;

export function getInvalidServiceRoutePathFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const manifest = value as Record<string, unknown>;
  return SERVICE_ROUTE_PATH_FIELDS.filter(
    (field) => field in manifest && typeof manifest[field] !== "string",
  );
}

/** A value short and plain enough to echo in an error (a line break in it could forge a second line, see lineBreakErrors). */
function echoValue(value: unknown): string {
  const text = JSON.stringify(value);
  return text !== undefined && /^[\w".:+-]{1,40}$/.test(text) ? ` ${text}` : "";
}

/**
 * An appType outside the published enum, or a port that is not an integer from PORT_MIN to PORT_MAX
 * (the shared rule-table bound, service-manifest-rules.ts). Tilt discovery only logs these as
 * warnings during `flisk up` (runtime/discovery/validation.star), so `flisk config verify` reports them first. The schema's
 * per-appType port ranges are not applied here: discovery uses different ranges, so the shared bound is the one both accept.
 */
export function appTypeAndPortErrors(
  manifest: Record<string, unknown>,
  displayPath: string,
): string[] {
  const errors: string[] = [];
  const appType = manifest.appType;
  if (
    typeof appType === "string" &&
    !(RESOURCE_CONFIG_APP_TYPES as readonly string[]).includes(appType)
  ) {
    errors.push(
      `${displayPath}.appType: unknown type${echoValue(appType)}; expected one of ${RESOURCE_CONFIG_APP_TYPES.join(", ")}`,
    );
  }
  const port = manifest.port;
  if (
    port !== undefined &&
    port !== null &&
    !(typeof port === "number" && Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX)
  ) {
    errors.push(
      `${displayPath}.port: expected an integer from ${PORT_MIN} to ${PORT_MAX}${echoValue(port) ? `, got${echoValue(port)}` : ""}`,
    );
  }
  return errors;
}
