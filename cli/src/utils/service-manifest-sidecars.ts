// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * `sidecarOf` (#2908): a bring-your-own resource that shares another resource's network namespace. Mirrors
 * engine/.../compose/byo_sidecar.star. Whether the host exists in the same stack is checked across services (checkSidecars).
 */
export function sidecarErrors(manifest: Record<string, unknown>, displayPath: string): string[] {
  const host = manifest.sidecarOf;
  if (host === undefined || host === null) return [];
  const field = `${displayPath}.sidecarOf`;
  if (manifest.appType !== "bring-your-own") {
    return [`${field}: only applies to bring-your-own resources (appType "bring-your-own")`];
  }
  if (typeof host !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/.test(host)) {
    return [`${field}: expected the appName of another resource in the same stack`];
  }
  const errors: string[] = [];
  if (host === manifest.appName) errors.push(`${field}: cannot name the resource itself`);
  if (Array.isArray(manifest.extraPorts) && manifest.extraPorts.length > 0) {
    errors.push(
      `${field}: a sidecar has no ports of its own; publish extraPorts on "${host}" instead`,
    );
  }
  if (manifest.replicas !== undefined && manifest.replicas !== 1) {
    errors.push(`${field}: needs a single container; remove replicas`);
  }
  return errors;
}
