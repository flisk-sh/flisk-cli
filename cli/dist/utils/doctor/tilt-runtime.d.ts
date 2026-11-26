import { execSync } from "node:child_process";
import type { CheckResult, DiscoveredResource } from "../../types/index.js";
import { type TiltPortOwner } from "../tilt-port-owner.js";
export interface TiltResourceFailure {
    name: string;
    updateStatus: string;
    runtimeStatus: string;
    error: string;
    /** True when waiting cannot fix this failure (a host port the runtime refuses to publish). */
    final?: boolean;
}
export declare function isPortPublishFailure(error: string): boolean;
/**
 * Tilt persists each resource's disable state in a `<name>-disable` ConfigMap on
 * first load. When `flisk config regenerate` (or a Tiltfile edit) adds a resource
 * to the focus allowlist while Tilt is already running, Tilt reloads the Tiltfile
 * but leaves that ConfigMap at `isDisabled: "true"`, so `disableStatus.state`
 * stays `Disabled` until `flisk down && flisk up`.
 *
 * Returns the names of resources in `tilt get uiresources -o json` that the
 * Tiltfile enables for the current run yet Tilt still reports as `Disabled`.
 *
 * `*-run-only` companions are never stale-disabled: they are manual
 * `docker compose up --no-build` triggers that a healthy focused run leaves
 * Disabled by design, so counting them sends callers to restart a stack that
 * needs no restart (flisk#3660).
 */
export declare function findStaleDisabledResources(jsonText: string, projectRoot?: string | null): string[];
/**
 * Resource names with `sablier: {enable: true, deferStart: true}` in their
 * manifest (openspec/changes/prioritized-cold-start): these are expected to
 * sit at `runtimeStatus: none` until their first request, not a sign of
 * anything stuck. Best-effort — returns an empty set if discovery fails
 * (e.g. not run from inside a project), so callers degrade to today's
 * behavior rather than erroring.
 */
export declare function getDeferredResourceNames(resources?: DiscoveredResource[], projectRoot?: string | null): Set<string>;
/**
 * Extract failing UIResources from `tilt get uiresources -o json`.
 *
 * `deferredNames` (typically from getDeferredResourceNames()) separates a
 * `sablier.deferStart` resource's expected `none`/`pending` status into its
 * own count so it's never described as "blocked" or otherwise lumped in with
 * genuinely stuck resources.
 */
export declare function parseTiltResourceFailures(jsonText: string, deferredNames?: Set<string>): {
    failures: TiltResourceFailure[];
    pendingCount: number;
    deferredCount: number;
    okCount: number;
    total: number;
};
export declare function summarizeTiltBuildError(error: string): string;
export declare function isRegistryRelatedBuildError(error: string): boolean;
export interface TiltResourceCheckOptions {
    /** Override project detection; null means the check runs outside a project. */
    projectRoot?: string | null;
    /** Override the port lookup (tests and callers that already resolved it). */
    tiltPort?: number;
    /** Override the host owner lookup so no lsof/ps is spawned in unit tests. */
    ownerOf?: (port: number) => TiltPortOwner | null;
}
/**
 * When a Tilt session is active, surface resource update errors (Traefik port
 * binds, image builds, etc.) instead of claiming the environment is ready
 * while apps sit forever in pending/none. Never read resources from a Tilt
 * that belongs to another project: use the same owner lookup as `status`.
 */
export declare function checkTiltResourceHealth(exec?: typeof execSync, options?: TiltResourceCheckOptions): CheckResult;
export declare function isInfraTiltFailure(name: string): boolean;
/** Critical infra first, then everything else — never drop failures. */
export declare function orderTiltFailures(failures: TiltResourceFailure[]): TiltResourceFailure[];
export declare function describeTiltFailure(failure: TiltResourceFailure, exec?: typeof execSync): string;
