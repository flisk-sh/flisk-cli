// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { findRunningFliskProjects } from "../../utils/down-cleanup.js";
import { errorFactories, FliskError, NotInProjectError } from "../../utils/errors.js";
import { writeMachineError } from "../../utils/machine-output.js";
import { readNativeRunState } from "../../utils/native-runtime.js";
import { isNativeProject } from "../../utils/native-service.js";
import { findProjectRoot } from "../../utils/paths.js";
import { resolveExplicitProject } from "../../utils/project-resolution.js";
import { promptConfirm } from "../../utils/prompt.js";
import {
  discoverResources,
  discoverResourcesFromRoot,
  discoverStacks,
} from "../../utils/services.js";

/** Quote a path for a shell hint such as `cd <path> && flisk down`. */
function quoteForShell(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** The stack names this project offers, for `tilt down` focus targets and artifact lookups; undefined when discovery fails. */
export function allStackNames(): string[] | undefined {
  try {
    const names = discoverStacks(discoverResources()).map((stack) => stack.name);
    return names.length > 0 ? names : undefined;
  } catch {
    return undefined;
  }
}

/** True when `flisk down` stops local processes instead of Tilt: a native run is on record, or every service declares `command`. */
export function isNativeRun(projectRoot: string): boolean {
  if (readNativeRunState(projectRoot)) return true;
  try {
    return isNativeProject(discoverResourcesFromRoot(projectRoot));
  } catch {
    return false;
  }
}

/**
 * The project to stop: the one at `--project`, else the one around the current folder, else the only Flisk project with
 * a `tilt up` running. Exits with the project-root error when none is found, and lists them when several are running.
 */
export async function resolveDownProject(options: {
  project?: string;
  json?: boolean;
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
}): Promise<string> {
  const fail = (error: FliskError): never => {
    if (options.json) writeMachineError(error);
    return error.exit();
  };
  if (options.project) {
    const explicit = resolveExplicitProject("down", options.project);
    if (explicit.error) {
      return fail(explicit.error);
    }
    return explicit.root;
  }

  const here = findProjectRoot();
  if (here) return here;

  const running = await findRunningFliskProjects();
  if (running.length === 1) {
    const root = running[0] as string;
    const consented = Boolean(options.yes || options.force);
    // Dry-run only previews what would stop, so it does not need shutdown consent.
    if (!consented && !options.dryRun) {
      let confirmed = false;
      if (!options.json && process.stdin.isTTY) {
        confirmed = await promptConfirm({
          message: `Not in a Flisk project; stop the one that is running at ${root}?`,
          initial: false,
        }).catch(() => false);
      }
      if (!confirmed) {
        const quoted = quoteForShell(root);
        return fail(
          new FliskError(`Not in a Flisk project; a different project is running: ${root}`, [
            `cd ${quoted} && flisk down`,
            `Or run flisk down --project ${quoted} to stop it explicitly, or pass --yes.`,
          ]),
        );
      }
    }
    if (!options.json)
      console.log(chalk.gray(`Not in a Flisk project; stopping the one that is running: ${root}`));
    return root;
  }
  if (running.length > 1) {
    return fail(
      new NotInProjectError(
        `Not in a Flisk project, and ${running.length} Flisk projects are running`,
        running.map((root) => `flisk down --project ${root}`),
      ),
    );
  }

  const notInProject = errorFactories.notInProject();
  return fail(
    new NotInProjectError(notInProject.message, [
      ...notInProject.suggestions,
      "Or name the project to stop from anywhere: flisk down --project <path>",
    ]),
  );
}
