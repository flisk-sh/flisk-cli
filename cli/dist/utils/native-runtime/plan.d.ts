import type { DiscoveredResource, ResourceConfig } from "../../types/index.js";
import { type ReadinessProbe } from "../service-manifest.js";
/**
 * The spawn plan of the native runtime: the per-service plan `flisk up` builds before it starts anything, the
 * dependency order it starts in, and the program-availability preflight. Everything here is pure planning —
 * nothing in this module spawns, signals or probes a process.
 */
/** Defaults for the periodic re-probe of a ready local process (#4692). */
export declare const DEFAULT_REPROBE_INTERVAL_MS = 5000;
export declare const DEFAULT_REPROBE_RETRIES = 3;
/** Everything the supervisor needs to start one service. */
export interface NativeServicePlan {
    name: string;
    command: string;
    /** The service directory: the command runs from where its service.json is. */
    cwd: string;
    port?: number;
    /** The service's own environment (`env` from service.json, expanded, then `params`/`envVars` literally) plus PORT. The process also inherits the shell's. */
    env: Record<string, string>;
    /** Raw unexpanded env map from service.json, preserved so ${migrator:KEY} can be resolved at runtime. */
    rawEnv?: Record<string, string>;
    dependsOn: string[];
    /** The `dependsOn` entries with an explicit `condition: "service_healthy"`: held until the probe passes, even when that service's health check is optional. */
    healthyDeps?: string[];
    /** Polled until it answers below 400 before dependents start. */
    healthUrl?: string;
    /** The raw health-check path, kept so values a migrator produced can rebind after the outputs exist. */
    rawHealthPath?: string;
    /** What `flisk up` prints for the service. */
    url?: string;
    restart: boolean;
    /** True only for `healthCheck: false` (or `{ enabled: false }`): readiness is then just "the process is still alive". */
    healthCheckDisabled?: boolean;
    /**
     * How often to re-probe an already-ready local process, and when to call it unhealthy (#4692). Absent means the defaults:
     * every 5 seconds, after 3 consecutive failures, `report`. Never set when `healthCheck: false` disabled the checks.
     */
    reprobe?: {
        intervalMs: number;
        retries: number;
        onFailure: "report" | "restart";
    };
    /** True for `healthCheck: { required: false }`: a failing health check is reported without blocking startup. */
    healthCheckOptional?: boolean;
    /** `healthCheck.port` or `healthCheck.command`: ready when that port accepts a connection, or the command exits 0 (#2875). */
    readiness?: ReadinessProbe;
    /** The raw readiness probe, kept so values a migrator produced can rebind after the outputs exist. */
    rawProbe?: ReadinessProbe;
    /** A one-shot job with no port (a migrator, or `"restart": "no"`): ready once it exits 0, never restarted (#2871). */
    job?: boolean;
    /** The container name when the service is a ready-made `image` that `docker run` starts in a mixed run. */
    container?: string;
}
/** True for a resource that runs once and exits: a migrator, or a bring-your-own resource with `"restart": "no"`. */
export declare function isOneShotJob(config: ResourceConfig | undefined): boolean;
/** `http://localhost:<port>` for display and health checks. Built here so callers never hold a URL literal. */
export declare function localUrl(port: number, path?: string): string;
/**
 * Whether a service gets its own process group. On Windows a detached child starts with its own console, and what it writes to
 * a pipe never reaches the parent: a crashed service's error (a missing variable, a stack trace) was lost, so the log files,
 * `flisk logs` and the failure text of `up` stayed empty. A Windows stop ends the whole tree with taskkill (signalGroup), so
 * it does not need a group; the cost is that a Ctrl+C in the terminal also reaches the services directly.
 */
export declare function detachesServices(platform?: NodeJS.Platform): boolean;
/**
 * Start order as waves: every service in a wave depends only on services in earlier waves. Names in `dependsOn` that are not
 * part of the selection are ignored here (planNativeRun reports them). Throws on a cycle; the service config gate refuses
 * cycles first, so this is a safety net.
 */
export declare function dependencyWaves(services: ReadonlyArray<{
    name: string;
    dependsOn: readonly string[];
}>): string[][];
export interface NativeRunPlan {
    services: NativeServicePlan[];
    /** Problems that stop the run before anything starts, each naming the service. */
    errors: string[];
    /** `${VAR}` references that expanded to nothing, as "service: VAR". */
    missingVars: string[];
    /** `${VAR}` references in a service's `env` that expanded to nothing, with the env key holding the reference. */
    missingEnvRefs: Array<{
        service: string;
        key: string;
        name: string;
    }>;
}
/**
 * Turns the selected `command` services into start plans and reports what would stop the run: a dependsOn that is not a service
 * of the selection (a database or the gateway needs Docker for now), and two services on one port.
 */
export declare function planNativeRun(selected: readonly DiscoveredResource[], vars?: Readonly<Record<string, string | undefined>>, projectRoot?: string, projectName?: string, options?: {
    includeDisabled?: boolean;
    persistCheckout?: boolean;
}): NativeRunPlan;
/**
 * Binds the planning-time placeholders that `${migrator:KEY}` references left in a plan: the raw env entries re-expand
 * against the produced values, then the raw health path and probe words rebind so a placeholder is never probed. The
 * supervisor calls this once the outputs exist, before the service (re)starts.
 */
export declare function resolvePlanLateValues(plan: NativeServicePlan, outputsRecord: Readonly<Record<string, Record<string, string>>>, baseEnv: Readonly<Record<string, string | undefined>>): void;
/**
 * Services whose command starts a program that is not on PATH, including programs started by a package-manager
 * script one level into the service's own package.json (#4680). A relative path such as ./bin/api is checked in the
 * service directory. `script` is set when the program came from a `scripts.<name>` entry.
 */
export declare function findMissingPrograms(plans: readonly NativeServicePlan[], find?: (program: string) => string | null, exists?: (path: string) => boolean, readFile?: (path: string) => string): Array<{
    name: string;
    program: string;
    script?: string;
}>;
