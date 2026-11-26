// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { Command } from "commander";
import { addYesOption, attachNoPositionalHint, handleDryRun } from "../utils/command-helpers.js";
import {
  findProjectComposeEventsWatchers,
  stopComposeEventsWatchers,
} from "../utils/compose-events-watchers.js";
import { getContainerRuntimeStatus } from "../utils/docker.js";
import { normalizeCacheUntil, validateCacheUntil } from "../utils/docker-build-cache.js";
import { FliskError, withTiltCheck } from "../utils/errors.js";
import { createJsonEmitter } from "../utils/json-output.js";
import { writeMachineError } from "../utils/machine-output.js";
import { readNativeRunState, stopNativeRun } from "../utils/native-runtime.js";
import { findProjectRoot } from "../utils/paths.js";
import { projectNameAt } from "../utils/project-registry.js";
import { addProjectOption } from "../utils/project-resolution.js";
import { isNativeRun, resolveDownProject } from "./down/find.js";
import {
  dockerOnlyFlagsNote,
  planNetworkPruneOrWarn,
  printNativeStop,
  pruneBuildCacheWithConsent,
  pruneNetworksOrWarn,
  pruneTiltImageTags,
  purgeOrWarn,
  purgeOwnershipRefusal,
  stopInferredProject,
  stopTiltStack,
} from "./down/stop.js";
import {
  describeArtifacts,
  isProjectIdle,
  nothingToStopWithoutDocker,
  probeIdleBeforePrerequisites,
  projectArtifacts,
  reportRetainedImages,
} from "./down/verify.js";
import { runDownAll } from "./down-all.js";

export const downCommand = addProjectOption(
  attachNoPositionalHint(addYesOption(new Command("down"))),
  "down",
)
  .description("Stop every running service of this project (local processes or Docker/Tilt)")
  .option("--all", "Stop every running Flisk project on this machine (one confirmation)", false)
  .option("-v, --verbose", "Enable verbose output", false)
  .option("-f, --force", "Deprecated alias for --yes; accepted for script compatibility", false)
  .option(
    "--prune-networks",
    "Remove this project's Docker networks that no container is attached to (Docker/Tilt projects only; the default, kept for scripts)",
  )
  .option(
    "--no-prune-networks",
    "Keep this project's Docker networks (by default the unused ones are removed, so Docker does not run out of address pools)",
  )
  .option(
    "--prune-cache [age]",
    "Also prune Docker build cache (shared across all projects on this machine; default age: 24h)",
    false,
  )
  .option(
    "--cache-until <age>",
    "With --prune-cache: age filter for prune (e.g. 24h, 168h, 7d; default: 24h)",
  )
  .option(
    "--purge",
    "Also drop this checkout's databases and delete this project's Docker volumes, networks and images",
    false,
  )
  .option("--dry-run", "Show what would be stopped without stopping", false)
  .option("--json", "Print one JSON object on stdout; implies quiet human output", false)
  .addHelpText(
    "after",
    "\nAfter stopping a container project, down prints how much disk its images and the shared build cache still hold, and the command that frees it.\n\nExamples:\n  flisk down --dry-run\n  flisk down --all\n  flisk down --all --yes --json\n  flisk down --json\n  flisk down --verbose",
  )
  .action(async (options, command: Command) => {
    // --all is a machine-wide inventory and stop; it never resolves or changes into a single project folder.
    if (options.all) {
      await runDownAll(options);
      return;
    }

    // Check for inferred Node project first, before resolveDownProject tries to find a Flisk project
    if (await stopInferredProject(options)) return;

    // The root program also defines `--project` (the one-command template flow), and Commander gives a root option to
    // the root wherever it appears, so `flisk down --project <path>` arrives in the global options.
    const project: string | undefined = options.project ?? command.optsWithGlobals().project;
    const resolvedRoot = await resolveDownProject({ ...options, project });

    const shouldPruneCache = Boolean(options.pruneCache);
    const rawCacheUntil =
      typeof options.pruneCache === "string" ? options.pruneCache : options.cacheUntil || "24h";

    if (shouldPruneCache && !validateCacheUntil(rawCacheUntil)) {
      const error = new FliskError(`Invalid --cache-until format: "${rawCacheUntil}"`, [
        "Use a duration such as 24h, 168h, 7d, or 2h30m",
      ]);
      if (options.json) writeMachineError(error);
      return error.exit();
    }
    // Normalize once here so the dry-run plan, the confirmation prompt and the real prune cannot
    // drift apart; pruneDockerBuildCache normalizes again defensively.
    const cacheUntil = normalizeCacheUntil(rawCacheUntil);
    // Everything below reads the project from the current folder (Tiltfile, stacks, networks), so stop from its root.
    if (findProjectRoot() !== resolvedRoot) process.chdir(resolvedRoot);

    if (options.force) {
      options.yes = true;
      if (!options.json) {
        console.warn(
          chalk.yellow("Note: --force (-f) on flisk down is deprecated; use --yes (-y) instead."),
        );
      }
    }

    const emit = options.json ? createJsonEmitter("DOWN_FAILED", "flisk down") : undefined;
    // A project of `command` services (or one with a native run on record) stops without Docker or Tilt.
    const projectRoot = findProjectRoot() as string;
    if (isNativeRun(projectRoot)) {
      // The recorded run's service keys are what a real down would signal, so a dry run can name them.
      const wouldStop = Object.keys(readNativeRunState(projectRoot)?.services ?? {});
      const dockerOnly = dockerOnlyFlagsNote(options);
      // A project converted from container stacks to `command` services can still carry the event watchers its
      // earlier stack left behind (#4854); a dry run names them without signaling.
      const nativeProjectName = projectNameAt(projectRoot);
      const nativeWatchers = nativeProjectName
        ? findProjectComposeEventsWatchers(projectRoot, nativeProjectName)
        : [];
      if (emit && options.dryRun) {
        emit({
          ok: true,
          dryRun: true,
          runtime: "native",
          wouldStop,
          ...(nativeWatchers.length > 0
            ? { wouldStopComposeWatchers: nativeWatchers.map((watcher) => watcher.pid) }
            : {}),
          ...(shouldPruneCache ? { wouldPruneCache: { until: cacheUntil } } : {}),
          ...(dockerOnly ? { warnings: [dockerOnly] } : {}),
        });
        return;
      }
      if (
        handleDryRun(
          options,
          "not stopping local processes",
          "stop the local processes of this project",
          () => {
            console.log(chalk.gray("Dry run - not stopping local processes"));
            if (wouldStop.length > 0) {
              console.log(`Would stop: ${wouldStop.join(", ")}`);
            } else {
              console.log(chalk.gray("Nothing is running for this project."));
            }
          },
        )
      ) {
        if (dockerOnly) console.log(chalk.gray(dockerOnly));
        if (nativeWatchers.length > 0) {
          console.log(
            chalk.gray(
              `Dry run - would stop ${nativeWatchers.length} "docker compose events" watcher process(es) (pid ${nativeWatchers.map((watcher) => watcher.pid).join(", ")}).`,
            ),
          );
        }
        if (shouldPruneCache) {
          console.log(
            chalk.gray(
              `Dry run - not pruning Docker build cache (would run: docker builder prune -f --filter until=${cacheUntil})`,
            ),
          );
        }
        return;
      }
      const stopped = await stopNativeRun(projectRoot);
      if (!options.json) {
        printNativeStop(stopped, "project");
        if (dockerOnly) console.log(chalk.gray(dockerOnly));
      }
      // Scanned again after the stop, so only a pid still proven to be our watcher is signaled.
      const stoppedNativeWatchers = nativeProjectName
        ? stopComposeEventsWatchers(
            findProjectComposeEventsWatchers(projectRoot, nativeProjectName),
          )
        : [];
      if (stoppedNativeWatchers.length > 0 && !options.json) {
        console.log(
          chalk.gray(
            `Stopped ${stoppedNativeWatchers.length} "docker compose events" watcher process(es) (pid ${stoppedNativeWatchers.join(", ")}).`,
          ),
        );
      }
      emit?.({
        ok: true,
        runtime: "native",
        stopped: stopped.services,
        stoppedEventWatchers: stoppedNativeWatchers,
        ...(stopped.stale ? { stale: true } : {}),
        ...(stopped.unverified?.length ? { unverified: stopped.unverified } : {}),
        ...(dockerOnly ? { warnings: [dockerOnly] } : {}),
      });
      return;
    }
    // `--purge` deletes the volume, networks and images of the project NAME, so refuse while another folder
    // or a foreign container owns them (#3961), in a dry run as well.
    if (options.purge) {
      const refusal = purgeOwnershipRefusal(projectRoot);
      if (refusal) {
        if (options.json) writeMachineError(refusal);
        return refusal.exit();
      }
    }
    // Unused networks go by default (--no-prune-networks opts out); --purge removes them too.
    const shouldPruneNetworks = options.pruneNetworks !== false;
    const hasCleanup = Boolean(options.purge || shouldPruneCache);
    // A plain `down` may stop at the idle shortcut. Ask the process list and Docker before the prerequisite checks so
    // the independent reads overlap, and the `docker ps` liveness check is redundant when `docker ps -a` already answered (#4173).
    const preflight =
      !options.dryRun && !hasCleanup
        ? await probeIdleBeforePrerequisites(projectRoot, shouldPruneNetworks)
        : undefined;
    const skipRuntimeCheck = preflight?.idle === true && !hasCleanup;
    // An empty project with Docker off has nothing to stop. Asking for Docker makes teardown look failed (#5029).
    // Check once and reuse the result: withTiltCheck below would otherwise ask a second time. When the idle probe
    // already got an answer from Docker there is nothing to ask.
    const containerRuntimeStatus = skipRuntimeCheck ? undefined : getContainerRuntimeStatus();
    if (
      !skipRuntimeCheck &&
      nothingToStopWithoutDocker({
        purge: options.purge,
        pruneCache: shouldPruneCache,
        pruneNetworks: options.pruneNetworks,
        containerRuntimeStatus,
      })
    ) {
      if (!options.json) console.log(chalk.gray("Nothing is running for this project."));
      emit?.({ ok: true, stopped: [], ...(options.dryRun ? { dryRun: true } : {}) });
      return;
    }
    const checkPrerequisites = <T>(action: () => Promise<T>): Promise<T> =>
      withTiltCheck(action, { skipRuntimeCheck, containerRuntimeStatus });

    await checkPrerequisites(async () => {
      // `docker compose ... events --json` streams Tilt opened for this project outlive `tilt down`;
      // nothing else reaps them, so `down` ends them too (#4854).
      const projectName = projectNameAt(projectRoot);
      const eventWatchers = projectName
        ? findProjectComposeEventsWatchers(projectRoot, projectName)
        : [];
      // The pid list above may be minutes old by the time the stack is down; a watcher that exited in between could
      // have left its pid to an unrelated process, so the last step re-reads the table and keeps only pids still
      // proven to be this project's event streams.
      const currentEventWatchers = () =>
        projectName
          ? eventWatchers.filter((watcher) =>
              findProjectComposeEventsWatchers(projectRoot, projectName).some(
                (fresh) => fresh.pid === watcher.pid,
              ),
            )
          : [];
      const wouldPurge =
        options.purge && options.dryRun ? projectArtifacts(projectRoot) : undefined;
      // Unused networks go by default (--no-prune-networks opts out); --purge removes them too, so the preview is for the plain run.
      const wouldPruneNetworks =
        options.pruneNetworks !== false && !options.purge && options.dryRun
          ? planNetworkPruneOrWarn(projectRoot, Boolean(options.json))
          : undefined;
      if (emit && options.dryRun) {
        emit({
          ok: true,
          dryRun: true,
          ...(shouldPruneCache ? { wouldPruneCache: { until: cacheUntil } } : {}),
          ...(wouldPurge ? { wouldPurge: wouldPurge.artifacts } : {}),
          ...(wouldPruneNetworks ? { wouldPruneNetworks } : {}),
          ...(eventWatchers.length > 0
            ? { wouldStopComposeWatchers: eventWatchers.map((watcher) => watcher.pid) }
            : {}),
        });
        return;
      }
      if (handleDryRun(options, "not stopping resources", "tilt down")) {
        if (eventWatchers.length > 0) {
          console.log(
            chalk.gray(
              `Dry run - would stop ${eventWatchers.length} "docker compose events" watcher process(es) (pid ${eventWatchers.map((watcher) => watcher.pid).join(", ")})`,
            ),
          );
        }
        if (wouldPruneNetworks) {
          const keep = wouldPruneNetworks.keep.map((kept) => `${kept.name} (${kept.reason})`);
          console.log(
            chalk.gray(
              `Dry run - network prune would remove: ${wouldPruneNetworks.remove.join(", ") || "<none>"}\n` +
                `          would keep: ${keep.join(", ") || "<none>"}`,
            ),
          );
        }
        if (wouldPurge) {
          const listed = describeArtifacts(wouldPurge.artifacts);
          console.log(
            chalk.gray(
              listed.length > 0
                ? `Dry run - --purge would delete:\n  ${listed.join("\n  ")}`
                : `Dry run - --purge would delete nothing: no Docker objects of ${wouldPurge.name} exist.`,
            ),
          );
        }
        if (shouldPruneCache) {
          console.log(
            chalk.gray(
              `Dry run - not pruning Docker build cache (would run: docker builder prune -f --filter until=${cacheUntil})`,
            ),
          );
        }
        return;
      }

      // Unused networks go by default: stopped projects that kept theirs used up Docker's address pools (#3650).
      const idle = preflight ? preflight.idle : isProjectIdle(projectRoot);
      if (idle && !hasCleanup) {
        if (!options.json) console.log(chalk.gray("Nothing is running for this project."));
        // The stack can be idle while event watchers it left behind still run.
        const idleStoppedWatchers = stopComposeEventsWatchers(currentEventWatchers());
        if (idleStoppedWatchers.length > 0 && !options.json) {
          console.log(
            chalk.gray(
              `Stopped ${idleStoppedWatchers.length} "docker compose events" watcher process(es) (pid ${idleStoppedWatchers.join(", ")}).`,
            ),
          );
        }
        // Networks an earlier `down` kept are still taken off the machine; the preflight already listed them.
        const leftover = shouldPruneNetworks
          ? pruneNetworksOrWarn(
              options.json,
              options.pruneNetworks === true,
              preflight?.networkNames,
            )
          : undefined;
        emit?.({
          ok: true,
          stoppedTilt: [],
          stoppedEventWatchers: idleStoppedWatchers,
          idle: true,
          ...(leftover ? { removedNetworks: leftover.removed, keptNetworks: leftover.kept } : {}),
        });
        return;
      }

      const { stoppedTilt, composeFallback } = await stopTiltStack(projectRoot, {
        idle,
        json: Boolean(options.json),
        verbose: Boolean(options.verbose),
      });

      // The stack is down; the event streams it started still listen on the daemon's event bus unless ended.
      const stoppedWatchers = stopComposeEventsWatchers(currentEventWatchers());
      if (stoppedWatchers.length > 0 && !options.json) {
        console.log(
          chalk.gray(
            `Stopped ${stoppedWatchers.length} "docker compose events" watcher process(es) (pid ${stoppedWatchers.join(", ")}).`,
          ),
        );
      }

      const networks =
        shouldPruneNetworks && !options.purge
          ? pruneNetworksOrWarn(options.json, options.pruneNetworks === true)
          : undefined;
      // After the stack is down: containers no longer hold the volumes and networks.
      const purged = options.purge ? purgeOrWarn(projectRoot, options.json) : undefined;

      const cachePruneResult = shouldPruneCache
        ? await pruneBuildCacheWithConsent(cacheUntil, {
            json: Boolean(options.json),
            yes: Boolean(options.yes),
          })
        : undefined;

      const tiltImages = options.dryRun
        ? undefined
        : await pruneTiltImageTags(Boolean(options.json));

      const retained = await reportRetainedImages(projectRoot, {
        purge: Boolean(options.purge),
        json: Boolean(options.json),
      });

      emit?.({
        ok: true,
        stoppedTilt,
        stoppedEventWatchers: stoppedWatchers,
        ...(retained ? { retained } : {}),
        ...(tiltImages && tiltImages.removed.length > 0
          ? { prunedTiltImages: tiltImages.removed }
          : {}),
        ...(composeFallback
          ? {
              composeFallback: {
                tiltDownExitCode: composeFallback.tiltDownExitCode,
                stopped: composeFallback.stopped,
              },
            }
          : {}),
        ...(networks ? { removedNetworks: networks.removed, keptNetworks: networks.kept } : {}),
        ...(purged
          ? {
              purged: purged.removed,
              keptAfterPurge: purged.kept,
              droppedDatabases: purged.databases,
            }
          : {}),
        ...(cachePruneResult ? { prunedCache: cachePruneResult } : {}),
      });
    });
  });
