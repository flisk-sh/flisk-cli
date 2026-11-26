import { type ProcessStartTimeReader } from "../process-identity.js";
import { type NativeServicePlan } from "./plan.js";
import { type NativeRestartResult } from "./supervision.js";
import type { SupervisorEvents } from "./types.js";
/**
 * Delay before the retry after `crashCount` consecutive quick crashes (#3820). Doubling starts small so a service waiting on
 * another one to become ready is not held back by a full second, but stops at 5s so repeated failures stay bounded.
 */
export declare function restartDelayForCrash(crashCount: number, baseMs?: number): number;
export declare class NativeSupervisor {
    private readonly projectRoot;
    private readonly events;
    private readonly options;
    private readonly services;
    /** Known size of each service log, shared by its stdout and stderr writers, for rotation (#3720). */
    private readonly logSizes;
    /** Last run id handed out per service; seeded from the log files so a new `up` continues the sequence (#4693). */
    private readonly runIds;
    private readonly migratorOutputs;
    /** Redacts one line of service output; rebuilt from the active plans whenever a restart reloads them. */
    private redactLine;
    /**
     * Plan secrets seen so far. A restart reloads only its own plan, while the other services keep running with the
     * values they started with, so the redactor only ever grows: it never forgets a secret a live process may print.
     */
    private readonly planSecrets;
    private readonly startedAt;
    /** One counter for every service in the project, resumed from the logs when a previous supervisor wrote them. */
    private readonly seq;
    private pidStartTime?;
    private stopping;
    private readonly optionalFailuresList;
    private baseEnv;
    private controlTimer?;
    private readonly restartHost;
    constructor(projectRoot: string, plans: readonly NativeServicePlan[], events?: SupervisorEvents, options?: {
        readyTimeoutMs?: number;
        restartDelayMs?: number;
        /** How long `stop()` waits after SIGTERM before it sends SIGKILL. Defaults to STOP_TIMEOUT_MS. */
        stopTimeoutMs?: number;
        /** Silence after a startup-error line that fails the wait. Defaults to STARTUP_ERROR_QUIET_MS. */
        startupErrorQuietMs?: number;
        /** The environment every service starts with, before its own `env`. Defaults to the shell's. */
        baseEnv?: Readonly<Record<string, string | undefined>>;
        /** Extra env files selected by --env-file; their values must be redacted too. */
        extraEnvPaths?: readonly string[];
        /** Reads a process start time for run.json. Defaults to processStartTime. */
        startTimeOf?: ProcessStartTimeReader;
        /** Plans and base env as they are now (the .env may have changed since start); a restart starts from these. */
        reload?: () => {
            plans: readonly NativeServicePlan[];
            baseEnv: Readonly<Record<string, string | undefined>>;
        };
    });
    /**
     * The redactor for the plans that are about to run. Local overrides are applied to the plans, not
     * written to service.json, so the discovery-based redactor cannot see them: their secret-named
     * env values are masked with the same rules (including ${VAR} expansions and multiline values kept
     * line by line) before any output is written.
     */
    private buildRedactor;
    /** The width service names are padded to in prefixed output. */
    get prefixWidth(): number;
    /**
     * Waits for one startup attempt of a service: its probe, or a full grace period with the *same* process alive. A process
     * that exits inside the grace is a failed attempt, so its restart gets a fresh wait instead of inheriting this one (#3950).
     */
    private waitForStartup;
    /**
     * Starts every service once its dependencies are ready. Resolves with the services that never became ready (empty when the
     * whole selection is up); a service whose dependency failed is reported as blocked and never started.
     */
    start(): Promise<Array<{
        name: string;
        reason: string;
        exitCode?: number | null;
    }>>;
    /**
     * Stops every service, dependents before what they depend on, and removes the run state. Services of one wave do not depend
     * on each other, so they get their SIGTERM grace period at the same time (#3811).
     */
    stop(): Promise<void>;
    /** The current process id of a service, for tests and diagnostics. */
    pidOf(name: string): number | undefined;
    /** HTTP readiness status codes recorded per service during startup. */
    readyStatuses(): ReadonlyMap<string, number>;
    /** Services with `healthCheck.required: false` whose health checks failed without blocking startup. */
    optionalFailures(): ReadonlyArray<{
        name: string;
        reason: string;
    }>;
    /** Parsed outputs produced by finished migrators (for inspection and tests). */
    outputsOf(migratorName: string): Record<string, string> | undefined;
    /**
     * True when the service wrote a startup-error line and then nothing for the quiet window while its
     * readiness probe still fails: a watcher is holding the crashed app's process, so the wait ends
     * early instead of running the whole timeout (#5038).
     */
    private isQuietAfterError;
    private resolveServiceEnv;
    /** The next short, per-service run id, surviving a supervisor restart through the markers in the log files. */
    private nextRunId;
    /** A full disk must not turn a run marker into a reason for the service to stop. */
    private writeRunStart;
    private writeRunExit;
    private spawn;
    private onExit;
    /** Starts a service again after it exited, and reports when it is ready again. */
    private respawn;
    /**
     * Re-probe an already-ready local process with the very same readiness signal used at startup (#4692). Containers keep their
     * Compose health check and one-shot jobs have nothing to probe after they finish.
     */
    private startReprobe;
    private stopReprobe;
    private reprobeOnce;
    /** Restarts an unhealthy process under the same MAX_QUICK_CRASHES limit as a process that exits. */
    private restartUnhealthy;
    /**
     * The dependencies of this run that are not ready now but may come back (restarting, or waiting themselves). One that gave up
     * never comes back, so a dependent is not made to wait for it: it counts its crashes and gives up with a visible message.
     */
    private dependenciesDown;
    /**
     * `name` became ready again: start each dependent that exited while it was down, and give a fresh start to one that stopped
     * restarting (it may have crashed before the supervisor saw the dependency go).
     */
    private resumeDependents;
    private readStartTime;
    /** Looks for restart requests from `flisk restart` (a separate process) a few times a second while the run is up. */
    private startControlLoop;
    /**
     * Stops one service and starts it again from its current plan, then waits for its readiness check. Only this service is
     * touched; dependents keep running and are started again by the usual rules if they exit while it is down. The result is
     * written for the requester: `ready`, `failed` (it exited before it was ready), or `timeout`.
     */
    restartService(name: string, id: string): Promise<NativeRestartResult>;
    /**
     * Reloads the service's plan and binds its late values for a requested restart. Returns the reason the previous
     * plan was kept, when the refreshed plan could not be bound.
     */
    private refreshServicePlan;
    /** A restart starts from the .env and plan as they are now, so a repaired value takes effect. */
    private refreshPlans;
    private saveState;
}
