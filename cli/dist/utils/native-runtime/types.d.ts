import type { ChildProcess } from "node:child_process";
import type { NativeServicePlan } from "./plan.js";
/**
 * Types the supervisor and its control channel share: the live per-service record the state machine
 * keeps, and the events it reports to `flisk up`.
 */
export interface RunningService {
    plan: NativeServicePlan;
    child?: ChildProcess;
    startedAt: number;
    quickCrashes: number;
    /** Passed its readiness check since it last started; recorded so `flisk status` can tell ready from starting. */
    isReady: boolean;
    gaveUp: boolean;
    /** Exit code of the process that ran most recently (null when a signal ended it), so a failure can name the cause (#4678). */
    lastExitCode: number | null;
    /** How the current process ended (cleared when it starts), so a startup failure can name the exit status (#3950). */
    lastExit?: {
        code: number | null;
        signal: NodeJS.Signals | null;
    };
    /** Exited while these dependencies were down; it starts again once they are all ready. */
    waitingFor?: string[];
    /** When the current process started, once read; saved so a later stop can prove the pid is still this process. */
    startTime?: string;
    /** Resolves once the current process identity has been saved. Readiness waits for it. */
    identityReady?: Promise<void>;
    restartTimer?: NodeJS.Timeout;
    /** A restart requested through the control channel is stopping and starting it: the exit of the old process is expected. */
    restarting?: boolean;
    /** Resolves with the exit code of the current process (null when a signal ended it). */
    exited?: Promise<number | null>;
    /** HTTP status code returned by the service's health check when it became ready. */
    readyStatus?: number;
    /** When the service last wrote a line; a service still printing is still starting, even after an error. */
    lastOutputAt?: number;
    /** Its output since the last spawn held a line a crashed process leaves behind under a watch-mode wrapper. */
    sawStartupError?: boolean;
    /** Consecutive failed periodic re-probes since the service last answered (#4692). */
    reprobeFailures: number;
    /** The reason a ready process was last reported unhealthy; cleared by one successful re-probe. */
    unhealthyReason?: string;
    /** The timer that re-probes an already-ready process. */
    reprobeTimer?: NodeJS.Timeout;
    /** `healthCheck.required: false` and its health check failed while the process kept running: dependents may proceed (see `dependenciesDown`). */
    optionalAccepted?: boolean;
}
/** Reports from the supervisor, so `flisk up` decides what reaches the terminal. */
export interface SupervisorEvents {
    /** One line of service output (no trailing newline). */
    onLine?: (service: string, line: string, stream: "stdout" | "stderr") => void;
    /** A lifecycle note: started, ready, exited, restarting, gave up. */
    onNote?: (service: string, message: string) => void;
}
