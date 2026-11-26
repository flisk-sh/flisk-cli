// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/** `webUi` (#2997) is read for bring-your-own resources only: the app serves pages from `/`, so it gets a host name, not a path prefix. */
export function webUiErrors(manifest: Record<string, unknown>, displayPath: string): string[] {
  if (manifest.webUi === undefined || manifest.webUi === null) return [];
  if (manifest.appType !== "bring-your-own")
    return [
      `${displayPath}.webUi: only applies to bring-your-own resources (appType "bring-your-own")`,
    ];
  if (manifest.webUi === true && manifest.sidecarOf)
    return [
      `${displayPath}.webUi: does not apply to a sidecar (sidecarOf), which has no route of its own`,
    ];
  return [];
}
