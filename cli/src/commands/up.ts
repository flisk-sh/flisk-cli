// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { Command } from "commander";
import { addProjectOption } from "../utils/project-resolution.js";
import { parseServiceNames } from "../utils/service-names.js";
import { createUpRun, runUpSteps } from "./up-steps.js";

export type { NativeUpSelection, ServiceHealth, UpOptions, UpRun, UpStep } from "./up-steps.js";
// The `flisk up` behaviour lives in up-steps.ts as an ordered pipeline (`upSteps`) over a shared run object
// (#4862); this module only describes the command and keeps the helpers that were always exported from
// `./up.js` available to the tests and command registry that import them here.
export {
  checkStackUrls,
  DRIFT_EXIT_CODE,
  defaultDockerReachable,
  driftReport,
  enforceDriftGate,
  enforceVersionFloor,
  fastNoopFlags,
  formatUpSuccess,
  hostUpRefusal,
  nativeWindowsUpRefusal,
  printFastNoopResult,
  selectNativeRun,
  selectRunEnvFile,
  toUpError,
  unknownServiceSuggestions,
  upError,
  waitForTiltUi,
  waitForTiltUnlessStartupFailed,
} from "./up-steps.js";

export const upCommand = addProjectOption(new Command("up"), "up")
  .description(
    "Start all services on this machine (optionally filtered by stack). Alias: deploy, which never deploys to a cluster",
  )
  .alias("deploy")
  .argument(
    "[stack-name]",
    "Name of the stack to start (optional - runs all if omitted), or a git repository URL to clone and start",
  )
  .option("-v, --verbose", "Enable verbose output", false)
  .option("-q, --quiet", "Suppress non-essential output", false)
  .option("--dry-run", "Show what would be started without starting", false)
  .option("-f, --force", "Kill existing Tilt process before starting", false)
  .option("--ignore-drift", "Start even if generated files differ from service.json", false)
  .option(
    "--ignore-version",
    "Start even if this flisk does not satisfy pinnedFliskVersion or minFliskVersion in .flisk/project.json",
    false,
  )
  .option(
    "--no-database",
    "Do not provision the bundled shared Postgres: saves capabilities.database=false in .flisk/project.json and regenerates .flisk/.flisk-out/ (set it to true to turn Postgres back on)",
  )
  .option(
    "--only <services...>",
    "Start only these services plus what the Tiltfile enables for them (their dependsOn services and shared infrastructure). With a stack, names must belong to that stack; dependencies may cross stacks",
  )
  .option(
    "--profile <names...>",
    'Also start the services whose "profiles" in service.json include one of these names (without it they are left out)',
  )
  .option(
    "--env-file <path>",
    "Use this project env file for the run instead of .env (for example: --env-file .env.integration)",
  )
  .option(
    "--no-gateway",
    'Run without gateway routing (no Traefik). Needs "capabilities": { "gateway": false } in .flisk/project.json; regenerates .flisk/.flisk-out/ from it',
  )
  .option(
    "--json",
    "Print one JSON object on stdout when the stack is ready or the command fails; implies --quiet",
    false,
  )
  .option(
    "--wait",
    "Start the stack in the background and return once every service is healthy (exit 0), or when it fails or --wait-timeout passes (exit 1). The stack keeps running; `flisk down` stops it",
    false,
  )
  .option(
    "--wait-timeout <seconds>",
    "With --wait: seconds to wait for a healthy stack, 1 to 21600 (default 1800)",
  )
  .addHelpText(
    "after",
    "\nFree disk space is checked first. Container projects: under 5 GiB flisk up stops, under 15 GiB it warns. Local-process projects: under 1 GiB it stops, under 2 GiB it warns. FLISK_DISK_MIN_GIB and FLISK_DISK_WARN_GIB change the limits of both. The shared Docker build cache is trimmed to 20 GiB (FLISK_BUILD_CACHE_MAX_GIB, 0 turns it off).\n\nExit codes: 2 for an argument you typed wrong (an unknown --only service, an unknown --profile, an invalid --wait-timeout, a rejected --env-file), 1 for a failure such as a stack that cannot start.\n\nExamples:\n  flisk up\n  flisk up shop\n  flisk up --dry-run\n  flisk up --ignore-drift",
  )
  .action(async (stackName, options) => {
    // Normalize once at the CLI boundary: every `--only` reader below, including the JSON envelope,
    // then sees the same names whether they were typed with spaces, commas or both (#5313).
    options.only = parseServiceNames(options.only as string[] | undefined);
    await runUpSteps(createUpRun(stackName, options));
  });
