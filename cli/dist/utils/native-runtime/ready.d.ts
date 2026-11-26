import { type ChildProcess } from "node:child_process";
import type { NativeServicePlan } from "./plan.js";
/**
 * The readiness seam of the native runtime: how a local process proves it is up (its health URL, its port,
 * a `healthCheck.command`, or just staying alive), plus the process-liveness checks the rest of the runtime
 * shares. `up`, `status` and `--wait` all read readiness through `waitForServiceReady`.
 */
/** How long `waitForServiceReady` polls before it reports a service not ready. */
export declare const DEFAULT_READY_TIMEOUT_MS = 60000;
export declare function sleep(milliseconds: number): Promise<void>;
/** True while the process exists (a zombie or another user's process counts as existing). */
export declare function isProcessAlive(pid: number): boolean;
/** True while the process has neither exited nor been ended by a signal (Node leaves `exitCode` null in the second case). */
export declare function isChildRunning(child: ChildProcess | undefined): boolean;
/**
 * True when something accepts TCP connections on localhost:port. The probe ends the socket
 * cleanly after connecting: an immediate destroy can make a server that has already written a
 * greeting log a connection reset, which looks like a failure to the person running `flisk up`.
 */
export declare function isPortListening(port: number, timeoutMs?: number): Promise<boolean>;
/**
 * The single readiness probe used while starting, restarting or waiting for a local process.
 * When the plan has an HTTP health URL the first probe is a real HTTP GET, so an HTTP server
 * never sees a bare connect that it would log as a reset. TCP and command checks keep their
 * own probe. This is shared by `up`, `status` and `--wait` through `waitForServiceReady`.
 */
export declare function probeServiceReady(plan: Pick<NativeServicePlan, "healthUrl" | "port" | "healthCheckDisabled"> & Partial<Pick<NativeServicePlan, "readiness" | "cwd" | "env">>): Promise<number | null>;
/** Polls a plan's readiness signal until it passes, `isAlive` turns false, or the timeout passes. */
export declare function waitForServiceReady(plan: Pick<NativeServicePlan, "healthUrl" | "port" | "healthCheckDisabled"> & Partial<Pick<NativeServicePlan, "readiness" | "cwd" | "env">>, options: {
    isAlive: () => boolean;
    timeoutMs?: number;
    intervalMs?: number;
    onStatus?: (status: number) => void;
    /** True once the service has finished on its own terms (a one-shot that exited 0): ready without a probe. */
    isFinished?: () => boolean;
}): Promise<boolean>;
/** What a service that never became ready was waiting for. */
export declare function notReadyReason(plan: NativeServicePlan): string;
/**
 * Why a service that gave up never became ready. Exit code 127 is the shell's "command not found": name the
 * program the service runs so the person sees what to install instead of a generic "kept exiting" (#4678).
 * A `"restart": "no"` service ran once and stopped, so its reason names how it ended instead (#5120).
 */
export declare function missingProgramReason(plan: NativeServicePlan, lastExitCode: number | null): string;
/** The "command not found" clause for an exit note, empty when the command does not name a single program. */
export declare function missingProgramNote(plan: NativeServicePlan): string;
/** Why a service's first start reported not-ready. */
export declare function startFailureReason(plan: NativeServicePlan, gaveUp: boolean, lastExitCode: number | null, readyTimeoutMs?: number): string;
/** Why a ready service was reported unhealthy after its periodic re-probes kept failing (#4692). */
export declare function reprobeFailureReason(plan: NativeServicePlan, failures: number): string;
