// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { getPackageVersion } from "../../utils/paths.js";
import { compareSemver } from "../../utils/semver.js";

/** Minimum Flisk core release supporting buildContext required by flisk import (#634). */
export const MIN_CORE_VERSION = "1.3.104";

/**
 * Recommended core for imported stacks: 1.4.11 (#2646) runs a bring-your-own port outside 4000-5999 and two-letter
 * names, which flisk-import 0.3.0 and later write. The pin ships in the CLI itself, so a CLI that runs it is already newer.
 */
export const RECOMMENDED_CORE_VERSION = "1.4.11";

/** Compares two semver version strings. Returns true if current >= minimum. */
export function isVersionAtLeast(current: string, minimum: string): boolean {
  const cmp = compareSemver(current, minimum);
  if (cmp === null) return false;
  return cmp >= 0;
}

/**
 * Checks whether the running Flisk CLI meets the minimum version required to adopt Compose repos.
 * If the installed core is older than the buildContext release (1.3.104), exit before writing
 * and print the upgrade command.
 */
export function checkCoreVersion(
  currentVersion: string = getPackageVersion(),
  args: string[] = [],
): { ok: boolean; message?: string } {
  const isWriting = !args.includes("--dry-run") && !args.includes("--help") && !args.includes("-h");
  if (!isWriting) {
    return { ok: true };
  }
  if (!isVersionAtLeast(currentVersion, MIN_CORE_VERSION)) {
    return {
      ok: false,
      message: `flisk import: installed Flisk core (${currentVersion}) is older than the required ${MIN_CORE_VERSION} (buildContext release). Upgrade with: flisk upgrade`,
    };
  }
  return { ok: true };
}
