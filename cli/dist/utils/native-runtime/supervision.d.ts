import { type ProcessStartTimeReader } from "../process-identity.js";
import type { RunningService } from "./types.js";
/**
 * Steering a native run: how a service.json command line becomes a process, how a process group is signalled
 * and stopped, how `flisk down` ends a run another process supervises, and the file-based channel through
 * which `flisk restart` asks the supervisor to restart one service. All of it is safe to call from a process
 * other than the supervising `flisk up`.
 */
/** How long a stopped process gets after SIGTERM before SIGKILL. */
export declare const STOP_TIMEOUT_MS = 5000;
/**
 * How a service.json `command` line is run: the platform shell, invoked the way Node's `shell: true` does it (`/bin/sh -c`,
 * or `%ComSpec% /d /s /c "<line>"` on Windows), spelled out so the call does not hand an opaque flag to spawn.
 */
export declare function shellInvocation(command: string, platform?: NodeJS.Platform, comSpec?: string | undefined): {
    file: string;
    args: string[];
    windowsVerbatimArguments: boolean;
};
/**
 * Signals a service's whole process group (the shell and what it started), falling back to the process alone. On Windows a
 * kill reaches only the shell (cmd.exe) and leaves the service it started running, so the whole process tree is ended instead.
 */
export declare function signalGroup(pid: number, signal: NodeJS.Signals, platform?: NodeJS.Platform, killTree?: (pid: number) => void): void;
/** SIGTERM to the process group, SIGKILL after the timeout. */
export declare function stopProcessGroup(pid: number, timeoutMs?: number, canSignal?: () => Promise<boolean>): Promise<void>;
/** What `stopNativeRun` uses to look at and stop processes; tests pass a fake process table. */
export interface NativeStopDeps {
    isAlive: (pid: number) => boolean;
    startTimeOf: ProcessStartTimeReader;
    bootTimeMs: () => number;
    /** SIGTERM to the supervising `flisk up`, then wait for it to stop its services. */
    terminateSupervisor: (pid: number, timeoutMs: number) => Promise<void>;
    /** SIGTERM, then SIGKILL, to a service's process group (its process tree on Windows). */
    stopGroup: (pid: number, startTime: string) => Promise<void>;
}
/**
 * Asks the supervising `flisk up` to stop, then waits for it to be gone. On POSIX that is a SIGTERM, which the supervisor
 * answers by stopping its services in order. Windows has no such signal: `process.kill` ends the process at once, and with it
 * the shells (cmd.exe) of its services, whose pipes close, but not the processes those shells started, which then run on with
 * no parent to find them by. So on Windows the supervisor's whole process tree is ended, services included.
 */
export declare function terminateSupervisorProcess(pid: number, timeoutMs: number, platform?: NodeJS.Platform, killTree?: (pid: number) => void): Promise<void>;
export interface NativeStopResult {
    wasRunning: boolean;
    services: string[];
    supervisorPid?: number;
    /** The record named only processes that are gone or are no longer Flisk's (a reboot, or pids reused since): nothing was signalled. */
    stale?: boolean;
    /** Live processes on record that could not be proven to be Flisk's (a run.json from before start times were saved): not signalled. */
    unverified?: Array<{
        name: string;
        pid: number;
    }>;
}
/**
 * Stops the native run recorded for this project: asks the supervising `flisk up` to stop its services, then stops any service
 * process still alive (a supervisor killed with SIGKILL cannot stop them itself). Returns the services that were stopped.
 *
 * A pid is signalled only while it still has the start time recorded when Flisk started it. After a reboot, a power loss or a
 * `kill -9` the record outlives its processes and the OS gives their pids to unrelated ones, which must never be killed (#3960).
 */
export declare function stopNativeRun(projectRoot: string, options?: {
    timeoutMs?: number;
    deps?: Partial<NativeStopDeps>;
}): Promise<NativeStopResult>;
export interface NativeRestartResult {
    /** `restarting`: accepted, not decided yet. */
    state: "restarting" | "ready" | "failed" | "timeout";
    pid?: number;
    reason?: string;
    /** Epoch ms before which log lines belong to an earlier start (set with a failure, for its log tail). */
    logsSince?: number;
}
/**
 * Asks the `flisk up` that supervises this project's local processes to restart one service, and waits for the outcome:
 * `ready`, `failed`, `timeout` (the service is still starting when `waitMs` passes), or `not-running` (no supervisor).
 * `waitMs: 0` returns as soon as the supervisor has accepted the request (`restarting`).
 */
export declare function requestNativeRestart(projectRoot: string, service: string, options: {
    waitMs: number;
}): Promise<NativeRestartResult | {
    state: "not-running";
    reason: string;
}>;
/** Writes the restart outcome the requester is polling for; a write failure means the requester times out. */
export declare function writeRestartResult(projectRoot: string, id: string, result: NativeRestartResult): void;
/** Looks for restart requests from `flisk restart` (a separate process) a few times a second while the run is up. */
export declare function watchRestartRequests(dir: string, isStopping: () => boolean, onRequest: (service: string, id: string) => void): NodeJS.Timeout;
/**
 * The slice of the supervisor that `restartSupervisedService` drives. The supervisor implements it over its
 * private state; keeping the restart flow here means the supervisor-side answer sits beside
 * `requestNativeRestart`, which speaks the other half of the same file protocol.
 */
export interface SupervisorRestartHost {
    projectRoot: string;
    serviceNamed: (name: string) => RunningService | undefined;
    isStopping: () => boolean;
    stopTimeoutMs?: number;
    readyTimeoutMs?: number;
    /** Silence after a startup-error line that fails the wait. Defaults to STARTUP_ERROR_QUIET_MS. */
    startupErrorQuietMs?: number;
    /** Reloads the service's plan and binds its late values; returns why the previous plan was kept, if it was. */
    refreshPlan: (service: RunningService) => string | undefined;
    spawn: (service: RunningService) => void;
    saveState: () => void;
    note: (service: string, message: string) => void;
    /** Called after a service reports ready again so waiting dependents start. */
    resumed: (name: string) => void;
    /** Starts the periodic re-probe of a service that is ready again (#4692). */
    reprobe?: (service: RunningService) => void;
}
/**
 * Stops one service and starts it again from its current plan, then waits for its readiness check. Only this service is
 * touched; dependents keep running and are started again by the usual rules if they exit while it is down. The result is
 * written for the requester: `ready`, `failed` (it exited before it was ready), or `timeout`.
 */
export declare function restartSupervisedService(host: SupervisorRestartHost, name: string, id: string): Promise<NativeRestartResult>;
