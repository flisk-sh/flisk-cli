import type { DiscoveredResource, ServiceRuntimeState } from "../types/index.js";
import { type NativeRunState } from "./native-runtime.js";
/**
 * The per-service health report `flisk up --wait --json` adds to a result that is not `ready`: every service
 * the run knew about, each `healthy`, `unhealthy` (still starting counts as not healthy, the same rule
 * `flisk status --unhealthy` uses) or `exited`, with a short reason when it is not healthy (#3102). The
 * reason prefers what the run already explained (the `up --json` failures), then the container's own record
 * (the last health probe's output, or its exit code), then the runtime state.
 */
export type UpWaitServiceStatus = "healthy" | "unhealthy" | "exited";
export interface UpWaitServiceHealth {
    name: string;
    status: UpWaitServiceStatus;
    reason?: string;
    blockedBy?: string[];
}
/** What `docker inspect` says about one service's container, trimmed to what the wait report needs. */
export interface ServiceContainerState {
    /** The container's exit code, when Docker reports it stopped. */
    exitCode: number | null;
    /** The last health probe's last output line, when Docker recorded one. */
    probeOutput: string | null;
}
export interface UpWaitHealthDeps {
    projectRoot: (cwd: string) => string | null;
    discover: (root: string) => DiscoveredResource[];
    isNative: (resources: DiscoveredResource[]) => boolean;
    nativeRun: (root: string) => NativeRunState | null;
    nativeStates: (root: string, names: readonly string[]) => Record<string, ServiceRuntimeState>;
    isAlive: (pid: number) => boolean;
    dependsOn: (resources: readonly DiscoveredResource[]) => Record<string, string[]>;
    deferred: (resources: DiscoveredResource[]) => Set<string>;
    tiltPort: (root: string) => number | null;
    fetchJson: (port: number) => Promise<string | null>;
    containerState: (service: string, composeProject: string, cwd: string) => Promise<ServiceContainerState | null>;
}
/** The services not healthy, in report order: the names `data.unhealthy` carries. */
export declare function unhealthyWaitServiceNames(entries: readonly UpWaitServiceHealth[]): string[];
/**
 * `docker inspect` on the service's compose container (`-a`, so an exited container still answers), scoped
 * by the project's own Compose project name so another project's `db` cannot answer. More than one
 * container with the labels, or Docker not answering, is "no answer": the entry keeps its reason.
 */
export declare function inspectServiceContainer(service: string, composeProject: string, cwd: string): Promise<ServiceContainerState | null>;
export interface TiltServiceHealth {
    entries: UpWaitServiceHealth[];
    /** Services whose reason the last health probe's output still improves (running, health check failing). */
    probe: Set<string>;
    /** Services whose reason the container's exit code still improves. */
    exited: Set<string>;
}
/**
 * One entry per service the Tilt run knew about. An `--only` selection adds the names it asked for even
 * when Tilt never got to them. Resources that are services of the project but not services the run started
 * (a profile kept out, a resource Tilt disabled) have no state and are left out.
 */
export declare function tiltServiceHealth(jsonText: string, names: readonly string[], dependsOn: Record<string, string[]>, deferred: Set<string>, only?: readonly string[]): TiltServiceHealth;
/**
 * The services of a local-process run that ran this time, each classified. A service the supervisor gave
 * up on (`failed`) and a one-shot job that exited non-zero are `exited`; a record still restarting or
 * waiting on a dependency is `unhealthy`. Nothing else ran means nothing to report.
 */
export declare function nativeServiceHealth(states: Record<string, ServiceRuntimeState>, run: NativeRunState | null, names: readonly string[], isAlive: (pid: number) => boolean): UpWaitServiceHealth[];
/**
 * Reasons a container record still improves: an `exited` entry gains its exit code ("exited with code 1",
 * appended to a reason the log already gave), and a health-check failure keeps the last probe's own output
 * when the reason so far is only the generic "container is running, but its health check is failing".
 */
export declare function enrichContainerReasons(entries: UpWaitServiceHealth[], probe: ReadonlySet<string>, exited: ReadonlySet<string>, inspect: (service: string) => Promise<ServiceContainerState | null>): Promise<UpWaitServiceHealth[]>;
export declare const defaultUpWaitHealthDeps: UpWaitHealthDeps;
/**
 * The `up --wait --json` per-service report for a wait that did not succeed. Resolves the project from
 * `cwd`, reads the local-process run state or Tilt's resource list the same way `flisk status` does, and
 * answers `[]` when no project or stack state can be found (the result then keeps its failures only).
 */
export declare function upWaitServiceHealth(options: {
    cwd: string;
    /** A `--only` selection, so a requested service Tilt never reached is still reported. */
    only?: readonly string[];
    /** The reasons `flisk up --json` already gave for its failures: they outrank a generic state reason. */
    preferReasons?: ReadonlyMap<string, string>;
}, deps?: UpWaitHealthDeps): Promise<UpWaitServiceHealth[]>;
