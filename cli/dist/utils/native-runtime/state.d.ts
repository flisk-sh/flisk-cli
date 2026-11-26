import type { ServiceRuntimeState } from "../../types/index.js";
/**
 * Where a native run keeps its state: `.flisk/native/run.json` records the supervisor and service process ids,
 * `.flisk/native/logs/<service>.log` their output, and `.flisk/native/control` the restart-request files. This
 * module reads and writes that state and answers the `flisk status`/`flisk logs` queries against it.
 */
/** The directory, under the project's .flisk/, that holds the run state and log files. */
export declare const NATIVE_DIR: string;
/** What `.flisk/native/run.json` holds while a native run is up. */
export interface NativeRunState {
    /** The `flisk up` process supervising the services. */
    pid: number;
    /** When that process started (see process-identity.ts), so a later stop can tell it from a process given the same pid. */
    pidStartTime?: string;
    startedAt: string;
    /** `job`: a one-shot job (a migrator, or `"restart": "no"` with no port); once it exits 0 it stays `ready` with no process. */
    services: Record<string, {
        pid?: number;
        /** When the service process started; a stop signals `pid` only while it still has this start time. */
        startTime?: string;
        port?: number;
        url?: string;
        ready?: boolean;
        job?: boolean;
        /** A container started with `docker run` in a mixed run. */
        container?: string;
        /** The dependencies a service exited without is waiting for before it starts again. */
        waitingFor?: string[];
        /** Why a ready process failed its periodic re-probe enough times to be reported unhealthy (#4692). */
        unhealthy?: string;
        /** The supervisor stopped restarting it (it kept crashing, or a job exited non-zero); only a restart or a new `up` revives it. */
        failed?: boolean;
        /** Last exit code of the service's process, null when a signal ended it; absent while it has not exited. */
        lastExitCode?: number | null;
    }>;
}
export declare function nativeRunStatePath(projectRoot: string): string;
export declare function nativeLogPath(projectRoot: string, service: string): string;
/** Where restart requests and their answers are exchanged between `flisk restart` and the supervising `flisk up`. */
export declare function nativeControlDir(projectRoot: string): string;
export declare function readNativeRunState(projectRoot: string): NativeRunState | null;
/**
 * The real ports of a native run, as recorded by the supervisor. A checkout running under its own name can hold a
 * different port from the one in service.json; status must report the port the service actually listens on (#4047).
 */
export declare function nativeRuntimePorts(state: NativeRunState | null): Map<string, number>;
/** The URLs a native run really serves, in service name order as recorded in run.json. */
export declare function nativeRuntimeUrls(state: NativeRunState | null): string[];
/**
 * The names a recorded native run still knows: every service in the run state plus any that wrote a
 * `.flisk/native/logs/<name>.log` file. A service.json discovery skipped hides its service from the
 * manifest list but not from these records, so a partial manifest list can still name it.
 */
export declare function recordedNativeServiceNames(projectRoot: string): string[];
/** True only when the supervisor pid still belongs to the process recorded for this native run. */
export declare function isNativeRunSupervisorAlive(state: NativeRunState | null): Promise<boolean>;
/** The services map of a run.json: the supervisor's live records in the recorded shape. */
export declare function runServicesRecord(services: ReadonlyMap<string, {
    child?: {
        pid?: number;
    };
    startTime?: string;
    plan: {
        port?: number;
        url?: string;
        job?: boolean;
        container?: string;
    };
    isReady: boolean;
    gaveUp: boolean;
    waitingFor?: string[];
    unhealthyReason?: string;
    lastExitCode?: number | null;
}>): NativeRunState["services"];
/** Writes `.flisk/native/run.json`, creating the run directory and its keep-out-of-git marker. */
export declare function writeNativeRunState(projectRoot: string, state: NativeRunState): void;
/** The reason of a live process that has not passed its readiness check yet (the only pending state with a running process). */
export declare const NATIVE_STARTING_REASON = "starting";
/**
 * Each service's state from the run on record, in the shape `flisk status` reports Tilt's: ready once it passed its readiness
 * check, unhealthy when periodic re-probes keep failing, pending while it starts or the supervisor restarts it, stopped when nothing runs it (#5131). Unknown is only for a
 * check that fails: a run file that exists but cannot be read leaves the state undecided.
 */
export declare function nativeServiceStates(projectRoot: string, services: readonly string[]): Record<string, ServiceRuntimeState>;
/** One line of a local process's output, as `flisk logs` reports it (the shape of a Tilt log line). */
export interface NativeLogLine {
    /** Written into the log by the supervisor, so it stays the same across reads (omitted in older logs). */
    seq?: number;
    time: string | null;
    resource: string;
    level: null;
    source: null;
    text: string;
    run: string | null;
}
/**
 * The last `tail` lines the given services wrote, oldest first, merged across services by time. `sinceMs` drops lines older
 * than that many milliseconds. `run` selects one run per service (`current`, `previous` or an id); without it every run is
 * returned, as before. A service that wrote nothing yet has no log file and contributes no lines. Supervisor markers are
 * never returned as output (#4693).
 */
export declare function readNativeLogLines(projectRoot: string, services: readonly string[], options: {
    tail: number;
    sinceMs?: number;
    now?: number;
    run?: string;
}): NativeLogLine[];
/** `name | ` in the service's color, padded so the output of several services lines up. */
export declare function formatPrefix(name: string, index: number, width: number): string;
