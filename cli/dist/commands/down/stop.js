// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { readProjectConfig } from "../../generator/template-engine.js";
import { dropCheckoutDatabases, } from "../../utils/checkout-database-purge.js";
import { exportCheckoutEnv } from "../../utils/checkout-id.js";
import { formatBytes, trimColimaAndMeasure } from "../../utils/colima-disk.js";
import { checkoutDatabaseSuffix } from "../../utils/database-name.js";
import { pruneDockerBuildCache } from "../../utils/docker-build-cache.js";
import { planProjectNetworkPrune, projectComposeProjects, pruneProjectNetworks, stopProjectComposeProjects, stopProjectTiltUp, waitForTiltUpExit, } from "../../utils/down-cleanup.js";
import { FliskError, handleTiltFailure } from "../../utils/errors.js";
import { inferNodeProject, inferredStateRoot } from "../../utils/inferred-node-project.js";
import { createJsonEmitter } from "../../utils/json-output.js";
import { stopNativeRun } from "../../utils/native-runtime.js";
import { findProjectRoot } from "../../utils/paths.js";
import { findForeignContainerOwners, findOtherRecordedFolders, purgeOwnerRefusal, } from "../../utils/project-owner.js";
import { countArtifacts, removeProjectArtifacts, } from "../../utils/project-purge.js";
import { projectNameAt, readProjectRecords } from "../../utils/project-registry.js";
import { promptConfirm } from "../../utils/prompt.js";
import { buildTiltDownArgs, getTiltfilePath, runTilt } from "../../utils/tilt.js";
import { pruneSupersededTiltImages } from "../../utils/tilt-images.js";
import { allStackNames } from "./find.js";
import { describeArtifacts, projectArtifacts } from "./verify.js";
/** The human summary of a native stop: what stopped, a stale record, and live processes left alone because they were not proven Flisk's. */
export function printNativeStop(stopped, scope) {
    if (stopped.stale) {
        console.log(chalk.gray("Stale run record, nothing to stop: its processes are gone or their pids now belong to other programs."));
    }
    else if (stopped.wasRunning) {
        console.log(chalk.blue(`Stopped local processes: ${stopped.services.join(", ")}`));
    }
    else {
        console.log(chalk.gray(`Nothing is running for this ${scope}.`));
    }
    if (stopped.unverified?.length) {
        const list = stopped.unverified.map(({ name, pid }) => `${name} (pid ${pid})`).join(", ");
        console.log(chalk.yellow(`These processes were not stopped because the run record cannot prove Flisk started them: ${list}. ` +
            "Check them and stop them yourself if they are this project's."));
    }
}
/**
 * `--purge` and `--prune-networks` remove Docker objects; a project that runs as local processes has none
 * (#3697). Name the flags that were passed instead of silently ignoring them.
 */
export function dockerOnlyFlagsNote(options) {
    const flags = [
        options.purge ? "--purge" : undefined,
        options.pruneNetworks ? "--prune-networks" : undefined,
    ].filter((flag) => Boolean(flag));
    if (flags.length === 0)
        return undefined;
    return `${flags.join(" and ")} ${flags.length === 1 ? "only applies" : "only apply"} to Docker/Tilt projects; nothing was removed from Docker.`;
}
/**
 * A folder that looks like a Node project but has no `.flisk/project.json` still gets its recorded local run stopped
 * with `flisk down`, so the command works before `flisk import`. Returns true when the command was handled here.
 */
export async function stopInferredProject(options) {
    const guess = inferNodeProject(process.cwd());
    if (!guess || options.project)
        return false;
    const emitInferred = options.json ? createJsonEmitter("DOWN_FAILED", "flisk down") : undefined;
    const dockerOnly = dockerOnlyFlagsNote(options);
    const stateRoot = inferredStateRoot(process.cwd());
    if (options.dryRun) {
        emitInferred?.({
            ok: true,
            dryRun: true,
            runtime: "native",
            inferred: true,
            ...(dockerOnly ? { warnings: [dockerOnly] } : {}),
        });
        if (!options.json) {
            console.log(chalk.gray("Dry run - not stopping the local process of this folder"));
            if (dockerOnly)
                console.log(chalk.gray(dockerOnly));
        }
        return true;
    }
    const stopped = await stopNativeRun(stateRoot);
    emitInferred?.({
        ok: true,
        runtime: "native",
        inferred: true,
        stopped: stopped.services,
        ...(stopped.stale ? { stale: true } : {}),
        ...(stopped.unverified?.length ? { unverified: stopped.unverified } : {}),
        ...(dockerOnly ? { warnings: [dockerOnly] } : {}),
    });
    if (!options.json) {
        printNativeStop(stopped, "folder");
        if (dockerOnly)
            console.log(chalk.gray(dockerOnly));
    }
    return true;
}
/**
 * `--purge` deletes the volume, networks and images of the project NAME. Another folder with the same name uses them too
 * (#3961), so refuse while a container or a recorded folder outside this one owns them; the refusal is the exit error.
 */
export function purgeOwnershipRefusal(projectRoot) {
    const name = projectNameAt(projectRoot);
    if (!name)
        return undefined;
    const records = readProjectRecords();
    const stacks = [
        ...new Set([
            ...(records.find((record) => record.name === name)?.stacks ?? []),
            ...(allStackNames() ?? []),
        ]),
    ];
    const refusal = purgeOwnerRefusal(name, findForeignContainerOwners(name, stacks, projectRoot), findOtherRecordedFolders(name, projectRoot));
    return refusal ? new FliskError(refusal.message, refusal.suggestions) : undefined;
}
/**
 * Stop this project's Tilt runtime: end `tilt up` first (it would re-create what `tilt down` removes), run `tilt down`,
 * and when the Tiltfile no longer evaluates (stale after an upgrade, a broken edit) stop the project's Compose projects
 * directly (#2899). `idle` skips the Tilt calls for a project already known down that still has cleanup flags.
 */
export async function stopTiltStack(projectRoot, options) {
    const tiltArgs = buildTiltDownArgs({
        focusTargets: allStackNames(),
    });
    // Stop `tilt up` first: `tilt down` does not end it, and a live Tilt re-creates the containers `tilt down` just removed.
    let stoppedTilt = [];
    if (!options.idle) {
        try {
            const tiltfile = getTiltfilePath();
            stoppedTilt = stopProjectTiltUp(tiltfile);
            if (stoppedTilt.length > 0)
                await waitForTiltUpExit(tiltfile);
        }
        catch {
            // Not fatal: the containers are already down.
        }
    }
    if (stoppedTilt.length > 0 && !options.json) {
        console.log(chalk.gray(`Stopped tilt up (pid ${stoppedTilt.join(", ")}).`));
    }
    if (!options.idle && !options.json)
        console.log(chalk.blue("Stopping all tilt resources..."));
    if (!options.idle && options.verbose && !options.json) {
        console.log(chalk.gray("Running: tilt down -f .flisk/.flisk-out/Tiltfile"));
    }
    if (!options.idle)
        exportCheckoutEnv(projectRoot);
    // Idle with a purge/prune flag: skip the Tiltfile load and go straight to the cleanup steps.
    const result = options.idle
        ? { exitCode: 0 }
        : await runTilt("down", tiltArgs, {
            verbose: options.verbose && !options.json,
            inheritStdio: !options.json,
        });
    // `tilt down` evaluates the Tiltfile, so a Tiltfile that fails leaves the stack running.
    let composeFallback;
    if (result.exitCode !== 0) {
        let fallback;
        try {
            fallback = stopProjectComposeProjects(projectRoot);
        }
        catch {
            handleTiltFailure("down", result.exitCode);
        }
        if (fallback.failed.length > 0) {
            for (const failed of fallback.failed) {
                console.error(chalk.red(`Could not stop Compose project ${failed.name}: ${failed.reason}`));
            }
            handleTiltFailure("down", result.exitCode);
        }
        composeFallback = { ...fallback, tiltDownExitCode: result.exitCode };
        if (!options.json) {
            console.log(chalk.yellow(fallback.stopped.length > 0
                ? `tilt down failed (exit ${result.exitCode}); stopped this project's containers with docker compose down instead: ${fallback.stopped.join(", ")}`
                : `tilt down failed (exit ${result.exitCode}); no containers of this project are left to stop.`));
        }
    }
    return { stoppedTilt, composeFallback };
}
/**
 * Remove this project's networks that no container uses. `isExplicit` is true when the user passed `--prune-networks`;
 * the run that happens after every `flisk down` stays quiet about networks Docker keeps and about a Docker that cannot
 * be asked.
 */
export function pruneNetworksOrWarn(json, isExplicit, networkNames) {
    const root = findProjectRoot();
    if (!root)
        return undefined;
    try {
        const result = networkNames
            ? pruneProjectNetworks(readProjectConfig(root).project.name, undefined, networkNames)
            : pruneProjectNetworks(readProjectConfig(root).project.name);
        if (!json) {
            if (result.removed.length > 0) {
                console.log(chalk.gray(`Removed networks: ${result.removed.join(", ")}`));
            }
            if (isExplicit) {
                for (const kept of result.kept) {
                    console.log(chalk.yellow(`Kept network ${kept.name}: ${kept.reason}`));
                }
            }
        }
        return result;
    }
    catch (err) {
        if (!json && isExplicit) {
            console.log(chalk.yellow(`Could not remove networks: ${err.message}`));
        }
        return undefined;
    }
}
/** What `--prune-networks` would remove and keep, for `--dry-run`; undefined when the networks cannot be checked. */
export function planNetworkPruneOrWarn(projectRoot, json) {
    try {
        // `down` stops this project's stacks before it prunes, so their containers do not keep a network.
        return planProjectNetworkPrune(readProjectConfig(projectRoot).project.name, undefined, projectComposeProjects(projectRoot));
    }
    catch (err) {
        if (!json) {
            console.log(chalk.yellow(`Could not check networks: ${err.message}`));
        }
        return undefined;
    }
}
/** Delete this checkout's databases and this project's Docker volumes, networks and images for `--purge`; undefined when the project name cannot be read. */
export function purgeOrWarn(projectRoot, json) {
    const found = projectArtifacts(projectRoot);
    if (!found) {
        if (!json)
            console.log(chalk.yellow("Could not read the project name; nothing purged."));
        return undefined;
    }
    // Drop logical databases while the shared Postgres container is still running; the volume stays so other
    // checkouts of this project keep their data (#4698).
    const databases = dropCheckoutDatabases(found.name, checkoutDatabaseSuffix(projectRoot));
    const result = removeProjectArtifacts(found.artifacts);
    if (!json) {
        if (databases.dropped.length > 0) {
            console.log(chalk.gray(`Dropped ${found.name} databases of this checkout: ${databases.dropped.join(", ")}`));
        }
        if (databases.skipped)
            console.log(chalk.yellow(`Could not drop checkout databases: ${databases.skipped}`));
        for (const kept of databases.kept) {
            console.log(chalk.yellow(`Kept database ${kept.name}: ${kept.reason}`));
        }
        const removed = describeArtifacts(result.removed);
        console.log(removed.length > 0
            ? chalk.gray(`Removed ${countArtifacts(result.removed)} Docker objects of ${found.name}:\n  ${removed.join("\n  ")}`)
            : chalk.gray(`No volumes, networks or images of ${found.name} are left.`));
        for (const kept of result.kept) {
            console.log(chalk.yellow(`Kept ${kept.kind.slice(0, -1)} ${kept.name}: ${kept.reason}`));
        }
    }
    return { ...result, databases };
}
/**
 * Prune Docker build cache older than `cacheUntil`, with the shared-machine warning and confirmation it needs.
 * The cache is shared across every project on this machine, so a non-terminal run or `--json` skips rather than
 * prompts; after the prune the freed space inside the Colima VM is trimmed back to the Mac where possible.
 */
export async function pruneBuildCacheWithConsent(cacheUntil, options) {
    let result;
    let confirmed = Boolean(options.yes);
    if (!confirmed) {
        if (options.json || !process.stdin.isTTY) {
            result = {
                until: cacheUntil,
                skipped: true,
                reason: "confirmation required; run in a terminal or pass --yes",
            };
            if (!options.json) {
                console.log(chalk.yellow("Skipping Docker build cache prune: confirmation required; run in a terminal or pass --yes."));
            }
        }
        else {
            console.log(chalk.yellow("Notice: Docker build cache is shared across all projects on this machine.\nPruning it affects other projects and may increase subsequent build times."));
            try {
                confirmed = await promptConfirm({
                    message: `Prune Docker build cache older than ${cacheUntil}?`,
                    initial: false,
                });
            }
            catch {
                confirmed = false;
            }
            if (!confirmed) {
                result = { until: cacheUntil, skipped: true, reason: "not confirmed" };
                console.log(chalk.gray("Skipped Docker build cache prune."));
            }
        }
    }
    if (confirmed) {
        try {
            const pruned = await pruneDockerBuildCache({ until: cacheUntil });
            result = { until: cacheUntil, reclaimed: pruned.reclaimed };
            if (!options.json) {
                console.log(chalk.gray(`Pruned Docker build cache: ${pruned.reclaimed} reclaimed (filter: until=${cacheUntil}).`));
            }
            // Pruning frees space inside the Colima VM only; its disk file keeps its size on the Mac until it is trimmed.
            try {
                const trimmed = await trimColimaAndMeasure();
                if (trimmed) {
                    const returned = formatBytes(trimmed.returnedBytes);
                    result = { ...result, hostReturned: returned };
                    if (!options.json) {
                        console.log(chalk.gray(`Trimmed the Colima VM: ${returned} returned to the Mac.`));
                    }
                }
            }
            catch (err) {
                if (!options.json) {
                    console.log(chalk.yellow(`Could not trim the Colima VM: ${err instanceof Error ? err.message : String(err)}. The Mac keeps the freed space until you run: colima ssh -- sudo fstrim -av`));
                }
            }
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            result = { until: cacheUntil, skipped: true, reason };
            if (!options.json) {
                console.log(chalk.yellow(`Could not prune Docker build cache: ${reason}`));
            }
        }
    }
    return result;
}
/**
 * Tilt tags every build tilt-<hash> and only a running Tilt cleans them up, so superseded builds pile up
 * (a day of rebuilds held 34 GB of images). Untag all but the newest per repo; running images are refused.
 */
export async function pruneTiltImageTags(json) {
    const tiltImages = await pruneSupersededTiltImages(1);
    if (tiltImages.removed.length > 0 && !json) {
        console.log(chalk.gray(`Removed ${tiltImages.removed.length} superseded tilt-* image(s) (up to ${(tiltImages.removedBytes / 1e9).toFixed(1)} GB).`));
    }
    return tiltImages;
}
