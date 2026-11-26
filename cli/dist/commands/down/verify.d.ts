import { type ContainerRuntimeStatus } from "../../utils/docker.js";
import { probeProjectIdle } from "../../utils/down-cleanup.js";
import { type Leftovers } from "../../utils/down-leftovers.js";
import { type ProjectArtifacts } from "../../utils/project-purge.js";
/**
 * True only when it is certain nothing of this project runs: no `tilt up` for its Tiltfile and no container of its
 * generated Compose projects (`docker ps -a`). Any doubt (`ps` or Docker cannot be asked) is "not idle", so `tilt down`
 * still runs. Loading the whole Tiltfile just to find nothing took 1.5 s (#3768).
 */
export declare function isProjectIdle(projectRoot: string): boolean;
/** The concurrent form of {@link isProjectIdle}, used before the prerequisite checks on the plain `down` path (#4173). */
export declare function probeIdleBeforePrerequisites(projectRoot: string, listNetworks: boolean): Promise<Awaited<ReturnType<typeof probeProjectIdle>>>;
/**
 * Docker is not running, and nothing of this project can be: no `tilt up`, and containers need a daemon.
 * `down` is cleanup, so this is success, not "Flisk can't start" (#5029). A purge, cache prune, or an
 * explicit network prune still needs Docker, and an unreadable process list is not treated as idle. A probe that
 * failed on permissions, authentication or the Docker context says nothing about the containers, so it is no shortcut.
 */
export declare function nothingToStopWithoutDocker(options: {
    purge?: boolean;
    pruneCache?: boolean | string;
    pruneNetworks?: boolean;
    containerRuntimeStatus?: ContainerRuntimeStatus;
}): boolean;
/** This project's Docker objects for `--purge`; undefined when the project name cannot be read. */
export declare function projectArtifacts(projectRoot: string): {
    name: string;
    artifacts: ProjectArtifacts;
} | undefined;
/** The non-empty kinds of a project artifact list as `kind: a, b` lines, for purge previews and reports. */
export declare function describeArtifacts(artifacts: ProjectArtifacts): string[];
/**
 * Report the images the stopped stack still holds: they, its volumes and the shared build cache still fill the disk
 * (#3708). Only a report: a Docker that cannot be asked must not fail `down`, so any failure is undefined.
 */
export declare function reportRetainedImages(projectRoot: string, options: {
    purge?: boolean;
    json?: boolean;
}): Promise<Leftovers | undefined>;
