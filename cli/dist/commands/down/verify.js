// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { readProjectConfig } from "../../generator/template-engine.js";
import { isSharedPostgresVolume } from "../../utils/checkout-database-purge.js";
import { dockerProbeFailedWithAccessError, getContainerRuntimeStatus, } from "../../utils/docker.js";
import { lookupProjectTiltUpPids, probeProjectIdle, projectComposeProjects, } from "../../utils/down-cleanup.js";
import { collectLeftovers, formatLeftovers } from "../../utils/down-leftovers.js";
import { listProjectArtifacts } from "../../utils/project-purge.js";
import { readProjectRecords } from "../../utils/project-registry.js";
import { getTiltfilePath } from "../../utils/tilt.js";
import { allStackNames } from "./find.js";
/**
 * True only when it is certain nothing of this project runs: no `tilt up` for its Tiltfile and no container of its
 * generated Compose projects (`docker ps -a`). Any doubt (`ps` or Docker cannot be asked) is "not idle", so `tilt down`
 * still runs. Loading the whole Tiltfile just to find nothing took 1.5 s (#3768).
 */
export function isProjectIdle(projectRoot) {
    try {
        const tiltUp = lookupProjectTiltUpPids(getTiltfilePath());
        if (tiltUp === null || tiltUp.length > 0)
            return false;
        return projectComposeProjects(projectRoot).length === 0;
    }
    catch {
        return false;
    }
}
/** The concurrent form of {@link isProjectIdle}, used before the prerequisite checks on the plain `down` path (#4173). */
export async function probeIdleBeforePrerequisites(projectRoot, listNetworks) {
    try {
        return await probeProjectIdle(projectRoot, getTiltfilePath(), { listNetworks });
    }
    catch {
        return { idle: false };
    }
}
/**
 * Docker is not running, and nothing of this project can be: no `tilt up`, and containers need a daemon.
 * `down` is cleanup, so this is success, not "Flisk can't start" (#5029). A purge, cache prune, or an
 * explicit network prune still needs Docker, and an unreadable process list is not treated as idle. A probe that
 * failed on permissions, authentication or the Docker context says nothing about the containers, so it is no shortcut.
 */
export function nothingToStopWithoutDocker(options) {
    if ((options.containerRuntimeStatus ?? getContainerRuntimeStatus()) !== "missing")
        return false;
    if (options.purge || options.pruneCache || options.pruneNetworks === true)
        return false;
    if (dockerProbeFailedWithAccessError())
        return false;
    try {
        const tiltUp = lookupProjectTiltUpPids(getTiltfilePath());
        return tiltUp !== null && tiltUp.length === 0;
    }
    catch {
        return false;
    }
}
/** This project's Docker objects for `--purge`; undefined when the project name cannot be read. */
export function projectArtifacts(projectRoot) {
    let name;
    try {
        name = readProjectConfig(projectRoot).project.name.toLowerCase();
    }
    catch {
        return undefined;
    }
    const records = readProjectRecords();
    // Stacks a project once had are on record; the ones it has now come from its folder.
    const record = records.find((record) => record.name === name);
    const stacks = [...new Set([...(record?.stacks ?? []), ...(allStackNames() ?? [])])];
    const knownNames = records.map((record) => record.name);
    const artifacts = listProjectArtifacts(name, {
        stacks,
        knownNames,
        roots: [...new Set([...(record?.roots ?? []), projectRoot])],
    });
    // A linked worktree and the main checkout share this volume. Removing it would destroy the other checkout's
    // databases even after we drop only this checkout's logical databases (#4698).
    return {
        name,
        artifacts: {
            ...artifacts,
            volumes: artifacts.volumes.filter((volume) => !isSharedPostgresVolume(volume, name)),
        },
    };
}
/** The non-empty kinds of a project artifact list as `kind: a, b` lines, for purge previews and reports. */
export function describeArtifacts(artifacts) {
    const out = [];
    if (artifacts.containers.length > 0)
        out.push(`containers: ${artifacts.containers.join(", ")}`);
    if (artifacts.volumes.length > 0)
        out.push(`volumes: ${artifacts.volumes.join(", ")}`);
    if (artifacts.networks.length > 0)
        out.push(`networks: ${artifacts.networks.join(", ")}`);
    if (artifacts.images.length > 0)
        out.push(`images: ${artifacts.images.join(", ")}`);
    return out;
}
/**
 * Report the images the stopped stack still holds: they, its volumes and the shared build cache still fill the disk
 * (#3708). Only a report: a Docker that cannot be asked must not fail `down`, so any failure is undefined.
 */
export async function reportRetainedImages(projectRoot, options) {
    try {
        const projectInfo = options.purge ? undefined : projectArtifacts(projectRoot);
        if (!projectInfo)
            return undefined;
        const retained = (await collectLeftovers(projectInfo.artifacts?.images ?? [])) ?? undefined;
        if (retained && !options.json) {
            for (const line of formatLeftovers(retained, projectInfo.name)) {
                console.log(chalk.yellow(line));
            }
        }
        return retained;
    }
    catch {
        return undefined;
    }
}
