import type { DiscoveredResource, ServiceRuntimeState } from "../types/index.js";
import type { ReadinessResult } from "./up-readiness.js";
/**
 * True when a state is a failing health check of a process that is up: a Tilt container that runs but is unhealthy, or a local
 * process that runs and has not passed its probe. A stopped or restarting process, a dependency wait and a failed job are not.
 */
export declare function isLiveHealthFailure(state: ServiceRuntimeState | undefined): boolean;
/**
 * True when a service opted out of blocking readiness (`healthCheck.required: false`) and only runs with a failing health check.
 * A job is excluded: it has no probe to wait for, and `pending` for a job means it has not finished.
 */
export declare function isNonBlockingOptionalState(resource: Pick<DiscoveredResource, "config">, state: ServiceRuntimeState | undefined): boolean;
/**
 * The services `--strict`, `wait` and other readiness gates fail on: the failing or still starting ones. Null when nothing
 * of the project is running (no state at all, or every service with a process of its own is unknown or stopped), which is also not
 * ready. A project with no services has nothing to wait for. Services with `healthCheck.required: false` whose
 * container/process is running but failing its health check do not fail the gate.
 */
export declare function strictNotReady(resources: readonly Pick<DiscoveredResource, "name" | "type" | "config">[], states: Record<string, ServiceRuntimeState> | null): string[] | null;
/**
 * A local-process run's answer to the readiness question agents read from `status --json`. It deliberately carries no
 * failures: a local run records each service's own state, which `status` and `wait` report per service instead.
 */
export declare function readinessFromNativeStates(states: Record<string, ServiceRuntimeState>, optionalHealth?: ReadonlySet<string>): ReadinessResult | null;
