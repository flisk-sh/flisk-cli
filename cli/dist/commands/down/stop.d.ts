import { type CheckoutDatabaseDrop } from "../../utils/checkout-database-purge.js";
import { type ComposeFallbackResult, planProjectNetworkPrune, pruneProjectNetworks } from "../../utils/down-cleanup.js";
import { FliskError } from "../../utils/errors.js";
import { type NativeStopResult } from "../../utils/native-runtime.js";
import { type PurgeResult } from "../../utils/project-purge.js";
import { pruneSupersededTiltImages } from "../../utils/tilt-images.js";
/** The human summary of a native stop: what stopped, a stale record, and live processes left alone because they were not proven Flisk's. */
export declare function printNativeStop(stopped: NativeStopResult, scope: "folder" | "project"): void;
/**
 * `--purge` and `--prune-networks` remove Docker objects; a project that runs as local processes has none
 * (#3697). Name the flags that were passed instead of silently ignoring them.
 */
export declare function dockerOnlyFlagsNote(options: {
    purge?: boolean;
    pruneNetworks?: boolean;
}): string | undefined;
/**
 * A folder that looks like a Node project but has no `.flisk/project.json` still gets its recorded local run stopped
 * with `flisk down`, so the command works before `flisk import`. Returns true when the command was handled here.
 */
export declare function stopInferredProject(options: {
    project?: string;
    json?: boolean;
    dryRun?: boolean;
    purge?: boolean;
    pruneNetworks?: boolean;
}): Promise<boolean>;
/**
 * `--purge` deletes the volume, networks and images of the project NAME. Another folder with the same name uses them too
 * (#3961), so refuse while a container or a recorded folder outside this one owns them; the refusal is the exit error.
 */
export declare function purgeOwnershipRefusal(projectRoot: string): FliskError | undefined;
/** What `stopTiltStack` reports back: the `tilt up` pids it stopped and the Compose fallback it ran, if `tilt down` failed. */
export interface TiltStopOutcome {
    stoppedTilt: number[];
    composeFallback?: ComposeFallbackResult & {
        tiltDownExitCode: number;
    };
}
/**
 * Stop this project's Tilt runtime: end `tilt up` first (it would re-create what `tilt down` removes), run `tilt down`,
 * and when the Tiltfile no longer evaluates (stale after an upgrade, a broken edit) stop the project's Compose projects
 * directly (#2899). `idle` skips the Tilt calls for a project already known down that still has cleanup flags.
 */
export declare function stopTiltStack(projectRoot: string, options: {
    idle: boolean;
    json: boolean;
    verbose: boolean;
}): Promise<TiltStopOutcome>;
/**
 * Remove this project's networks that no container uses. `isExplicit` is true when the user passed `--prune-networks`;
 * the run that happens after every `flisk down` stays quiet about networks Docker keeps and about a Docker that cannot
 * be asked.
 */
export declare function pruneNetworksOrWarn(json: boolean, isExplicit: boolean, networkNames?: readonly string[]): ReturnType<typeof pruneProjectNetworks> | undefined;
/** What `--prune-networks` would remove and keep, for `--dry-run`; undefined when the networks cannot be checked. */
export declare function planNetworkPruneOrWarn(projectRoot: string, json: boolean): ReturnType<typeof planProjectNetworkPrune> | undefined;
/** Delete this checkout's databases and this project's Docker volumes, networks and images for `--purge`; undefined when the project name cannot be read. */
export declare function purgeOrWarn(projectRoot: string, json: boolean): (PurgeResult & {
    databases?: CheckoutDatabaseDrop;
}) | undefined;
/** The `--prune-cache` outcome folded into the JSON emit: reclaimed space, or why the prune was skipped. */
export interface CachePruneResult {
    until: string;
    reclaimed?: string;
    hostReturned?: string;
    skipped?: boolean;
    reason?: string;
}
/**
 * Prune Docker build cache older than `cacheUntil`, with the shared-machine warning and confirmation it needs.
 * The cache is shared across every project on this machine, so a non-terminal run or `--json` skips rather than
 * prompts; after the prune the freed space inside the Colima VM is trimmed back to the Mac where possible.
 */
export declare function pruneBuildCacheWithConsent(cacheUntil: string, options: {
    json: boolean;
    yes: boolean;
}): Promise<CachePruneResult | undefined>;
/**
 * Tilt tags every build tilt-<hash> and only a running Tilt cleans them up, so superseded builds pile up
 * (a day of rebuilds held 34 GB of images). Untag all but the newest per repo; running images are refused.
 */
export declare function pruneTiltImageTags(json: boolean): Promise<Awaited<ReturnType<typeof pruneSupersededTiltImages>>>;
