// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { commandProgram } from "../native-service.js";
/**
 * The readiness seam of the native runtime: how a local process proves it is up (its health URL, its port,
 * a `healthCheck.command`, or just staying alive), plus the process-liveness checks the rest of the runtime
 * shares. `up`, `status` and `--wait` all read readiness through `waitForServiceReady`.
 */
/** How long `waitForServiceReady` polls before it reports a service not ready. */
export const DEFAULT_READY_TIMEOUT_MS = 60_000;
const ALIVE_GRACE_MS = 1_000;
/** How long one run of a `healthCheck.command` may take before it counts as a failed probe. */
const READINESS_COMMAND_TIMEOUT_MS = 10_000;
export function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
/** True while the process exists (a zombie or another user's process counts as existing). */
export function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
/** True while the process has neither exited nor been ended by a signal (Node leaves `exitCode` null in the second case). */
export function isChildRunning(child) {
    return child !== undefined && child.exitCode === null && child.signalCode === null;
}
/**
 * True when something accepts TCP connections on localhost:port. The probe ends the socket
 * cleanly after connecting: an immediate destroy can make a server that has already written a
 * greeting log a connection reset, which looks like a failure to the person running `flisk up`.
 */
export function isPortListening(port, timeoutMs = 1_000) {
    return new Promise((resolve) => {
        const socket = connect({ host: "localhost", port });
        let settled = false;
        const finish = (listening, graceful) => {
            if (settled)
                return;
            settled = true;
            if (graceful && !socket.destroyed) {
                socket.end();
                // Drain anything the server sent so its write finishes before we let go of the socket.
                socket.resume();
                socket.once("close", () => socket.destroy());
            }
            else {
                socket.destroy();
            }
            resolve(listening);
        };
        socket.setTimeout(timeoutMs, () => finish(false, false));
        socket.once("connect", () => finish(true, true));
        socket.once("error", () => finish(false, false));
    });
}
async function healthCheckStatus(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
        await response.body?.cancel();
        return response.status < 400 ? response.status : null;
    }
    catch {
        return null;
    }
}
/**
 * The single readiness probe used while starting, restarting or waiting for a local process.
 * When the plan has an HTTP health URL the first probe is a real HTTP GET, so an HTTP server
 * never sees a bare connect that it would log as a reset. TCP and command checks keep their
 * own probe. This is shared by `up`, `status` and `--wait` through `waitForServiceReady`.
 */
export async function probeServiceReady(plan) {
    const readiness = plan.healthCheckDisabled ? undefined : plan.readiness;
    if (readiness?.kind === "port") {
        return (await isPortListening(readiness.port)) ? 0 : null;
    }
    if (readiness?.kind === "command") {
        return (await readinessCommandPasses(readiness.command, plan)) ? 0 : null;
    }
    if (plan.healthUrl)
        return healthCheckStatus(plan.healthUrl);
    return plan.port !== undefined && (await isPortListening(plan.port)) ? 0 : null;
}
/** Polls a plan's readiness signal until it passes, `isAlive` turns false, or the timeout passes. */
export async function waitForServiceReady(plan, options) {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    const interval = options.intervalMs ?? 250;
    const readiness = plan.healthCheckDisabled ? undefined : plan.readiness;
    if (!readiness && (plan.healthCheckDisabled || (!plan.healthUrl && plan.port === undefined))) {
        await sleep(ALIVE_GRACE_MS);
        return options.isAlive();
    }
    while (Date.now() < deadline) {
        if (options.isFinished?.())
            return true;
        if (!options.isAlive())
            return false;
        const status = await probeServiceReady(plan);
        if (status !== null) {
            if (status > 0)
                options.onStatus?.(status);
            return true;
        }
        // A probe that was pending while a one-shot exited 0 must not turn into a timeout.
        if (options.isFinished?.())
            return true;
        await sleep(interval);
    }
    // The deadline can pass while the last probe is pending: recheck completion before reporting a timeout.
    return options.isFinished?.() === true;
}
/** What a service that never became ready was waiting for. */
export function notReadyReason(plan) {
    if (plan.readiness?.kind === "port")
        return `nothing listening on port ${plan.readiness.port}`;
    if (plan.readiness?.kind === "command") {
        return `healthCheck.command never exited 0: ${plan.readiness.command.join(" ")}`;
    }
    if (plan.healthUrl)
        return `no answer from ${plan.healthUrl}`;
    if (plan.port !== undefined)
        return `nothing listening on port ${plan.port}`;
    return "the process exited before it was ready";
}
/**
 * Why a service that gave up never became ready. Exit code 127 is the shell's "command not found": name the
 * program the service runs so the person sees what to install instead of a generic "kept exiting" (#4678).
 * A `"restart": "no"` service ran once and stopped, so its reason names how it ended instead (#5120).
 */
export function missingProgramReason(plan, lastExitCode) {
    if (lastExitCode === 127) {
        const program = commandProgram(plan.command);
        if (program)
            return `runs ${program}, which is not installed`;
    }
    if (!plan.restart) {
        return lastExitCode === null
            ? `stopped by a signal; not restarting ("restart": "no")`
            : `exited with code ${lastExitCode}; not restarting ("restart": "no")`;
    }
    return "kept exiting; see its output above";
}
/** The "command not found" clause for an exit note, empty when the command does not name a single program. */
export function missingProgramNote(plan) {
    const program = commandProgram(plan.command);
    return program ? `: ${plan.name} runs ${program}, which is not installed` : "";
}
/** Why a service's first start reported not-ready. */
export function startFailureReason(plan, gaveUp, lastExitCode, readyTimeoutMs) {
    if (plan.job)
        return "the job did not exit 0; see its output above";
    if (gaveUp)
        return missingProgramReason(plan, lastExitCode);
    return `not ready after ${Math.round((readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS) / 1000)}s (${notReadyReason(plan)})`;
}
/** Runs a `healthCheck.command` once from the service folder with its env; true when it exits 0. */
function readinessCommandPasses(command, plan) {
    const [file, ...args] = command;
    if (!file)
        return Promise.resolve(false);
    return new Promise((resolve) => {
        const child = spawn(file, args, {
            cwd: plan.cwd,
            env: { ...process.env, ...(plan.env ?? {}) },
            stdio: "ignore",
            windowsHide: true,
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), READINESS_COMMAND_TIMEOUT_MS);
        child.once("error", () => {
            clearTimeout(timer);
            resolve(false);
        });
        child.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}
/** Why a ready service was reported unhealthy after its periodic re-probes kept failing (#4692). */
export function reprobeFailureReason(plan, failures) {
    if (plan.readiness?.kind === "port") {
        return `nothing listening on port ${plan.readiness.port} (${failures} consecutive probes)`;
    }
    if (plan.readiness?.kind === "command") {
        return `healthCheck.command never exited 0: ${plan.readiness.command.join(" ")} (${failures} consecutive probes)`;
    }
    if (plan.healthUrl) {
        const path = new URL(plan.healthUrl).pathname;
        return `GET ${path} failed ${failures} consecutive probes`;
    }
    return `nothing listening on port ${plan.port} (${failures} consecutive probes)`;
}
