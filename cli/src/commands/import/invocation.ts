// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  type NpxInvocation,
  type PackageRunnerRuntime,
  packageRunnerInvocation,
  safePackageSpec,
} from "../../utils/npx-invocation.js";

/**
 * The importer lives in its own repo so it can ship without a CLI release, and is run from npm at a
 * pinned version so a push to its main branch cannot change what `flisk import` does. Move the pin
 * when a new importer is published. `FLISK_IMPORT_PACKAGE` overrides the package spec.
 */
export const IMPORT_PACKAGE = "flisk-import@0.18.3";

/** The flisk-import subcommand that registers a Tiltfile (flisk-import 0.4.1 or later), forwarded as its first argument. */
export const TILTFILE_IMPORTER = "tiltfile";

export function importInvocation(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  runtime: Omit<PackageRunnerRuntime, "platform"> = {},
): NpxInvocation & { pkg: string } {
  const pkg = safePackageSpec(env.FLISK_IMPORT_PACKAGE, IMPORT_PACKAGE);
  const invocation = packageRunnerInvocation([pkg, ...args], {
    ...runtime,
    platform,
    pathEnv: runtime.pathEnv ?? env.PATH ?? env.Path,
  });
  return { ...invocation, pkg };
}

export function buildForwardedImportArgs(
  args: string[],
  options: { yes?: boolean; force?: boolean; dryRun?: boolean } = {},
): string[] {
  let yes = Boolean(options.yes);
  let force = Boolean(options.force);

  const filtered: string[] = [];
  // `tiltfile` forwards its own path, which may be any name, so only the Compose keyword is ever stripped.
  let strippedCompose = args[0] === TILTFILE_IMPORTER;
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (!strippedCompose && arg === "compose") {
      strippedCompose = true;
    } else {
      filtered.push(arg);
    }
  }

  if (options.dryRun && !filtered.includes("--dry-run")) {
    filtered.push("--dry-run");
  }
  if (yes) {
    filtered.push("--yes");
  }
  if (force) {
    filtered.push("--force");
  }
  return filtered;
}
