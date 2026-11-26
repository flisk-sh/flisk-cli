// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clearMigratorOutputs } from "../migrator-output.js";
import { removeNativeContainers } from "../native-container.js";
import { bootTimeMs, processStartTime } from "../process-identity.js";
import { DEFAULT_READY_TIMEOUT_MS, isChildRunning, isProcessAlive, notReadyReason, sleep, waitForServiceReady, } from "./ready.js";
import { isQuietAfterStartupError, STARTUP_ERROR_QUIET_MS, STARTUP_ERROR_REASON, } from "./startup-error.js";
import { nativeControlDir, nativeRunStatePath, readNativeRunState } from "./state.js";
/**
 * Steering a native run: how a service.json command line becomes a process, how a process group is signalled
 * and stopped, how `flisk down` ends a run another process supervises, and the file-based channel through
 * which `flisk restart` asks the supervisor to restart one service. All of it is safe to call from a process
 * other than the supervising `flisk up`.
 */
/** How long a stopped process gets after SIGTERM before SIGKILL. */
export const STOP_TIMEOUT_MS = 5_000;
/**
 * How a service.json `command` line is run: the platform shell, invoked the way Node's `shell: true` does it (`/bin/sh -c`,
 * or `%ComSpec% /d /s /c "<line>"` on Windows), spelled out so the call does not hand an opaque flag to spawn.
 */
export function shellInvocation(command, platform = process.platform, comSpec = process.env.ComSpec) {
    if (platform === "win32") {
        return {
            file: comSpec || "cmd.exe",
            args: ["/d", "/s", "/c", `"${command}"`],
            windowsVerbatimArguments: true,
        };
    }
    return { file: "/bin/sh", args: ["-c", command], windowsVerbatimArguments: false };
}
/** Ends a process and every process it started, with `taskkill /T /F`: Windows has no process groups to signal. */
function killWindowsTree(pid) {
    // S4036: taskkill.exe ships in System32, so resolve it at a fixed, system-owned path instead of a PATH search.
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    try {
        execFileSync(taskkill, ["/pid", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
        });
    }
    catch {
        // Already gone.
    }
}
/**
 * Signals a service's whole process group (the shell and what it started), falling back to the process alone. On Windows a
 * kill reaches only the shell (cmd.exe) and leaves the service it started running, so the whole process tree is ended instead.
 */
export function signalGroup(pid, signal, platform = process.platform, killTree = killWindowsTree) {
    if (platform === "win32") {
        killTree(pid);
        return;
    }
    try {
        process.kill(-pid, signal);
    }
    catch {
        try {
            process.kill(pid, signal);
        }
        catch {
            // Already gone.
        }
    }
}
async function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid))
            return true;
        await sleep(100);
    }
    return !isProcessAlive(pid);
}
/** SIGTERM to the process group, SIGKILL after the timeout. */
export async function stopProcessGroup(pid, timeoutMs = STOP_TIMEOUT_MS, canSignal = async () => true) {
    if (!(await canSignal()))
        return;
    signalGroup(pid, "SIGTERM");
    if (!(await waitForExit(pid, timeoutMs)) && (await canSignal()))
        signalGroup(pid, "SIGKILL");
}
/**
 * Asks the supervising `flisk up` to stop, then waits for it to be gone. On POSIX that is a SIGTERM, which the supervisor
 * answers by stopping its services in order. Windows has no such signal: `process.kill` ends the process at once, and with it
 * the shells (cmd.exe) of its services, whose pipes close, but not the processes those shells started, which then run on with
 * no parent to find them by. So on Windows the supervisor's whole process tree is ended, services included.
 */
export async function terminateSupervisorProcess(pid, timeoutMs, platform = process.platform, killTree = killWindowsTree) {
    if (platform === "win32") {
        killTree(pid);
    }
    else {
        try {
            process.kill(pid, "SIGTERM");
        }
        catch {
            // Gone between the check and the signal.
        }
    }
    await waitForExit(pid, timeoutMs);
}
const defaultStopDeps = {
    isAlive: isProcessAlive,
    startTimeOf: (pid) => processStartTime(pid),
    bootTimeMs,
    terminateSupervisor: (pid, timeoutMs) => terminateSupervisorProcess(pid, timeoutMs),
    stopGroup: (pid, startTime) => stopProcessGroup(pid, STOP_TIMEOUT_MS, async () => (await processStartTime(pid)) === startTime),
};
/**
 * Stops the native run recorded for this project: asks the supervising `flisk up` to stop its services, then stops any service
 * process still alive (a supervisor killed with SIGKILL cannot stop them itself). Returns the services that were stopped.
 *
 * A pid is signalled only while it still has the start time recorded when Flisk started it. After a reboot, a power loss or a
 * `kill -9` the record outlives its processes and the OS gives their pids to unrelated ones, which must never be killed (#3960).
 */
export async function stopNativeRun(projectRoot, options = {}) {
    const state = readNativeRunState(projectRoot);
    if (!state)
        return { wasRunning: false, services: [] };
    const deps = { ...defaultStopDeps, ...options.deps };
    const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS * 2;
    const forget = () => {
        // A `docker run` killed before it passed the stop on leaves its container running; containers are found by name, not pid.
        if (Object.values(state.services).some((service) => service.container)) {
            removeNativeContainers(projectRoot);
        }
        rmSync(nativeRunStatePath(projectRoot), { force: true });
        clearMigratorOutputs(projectRoot);
    };
    // Every process of a run recorded before the last boot is gone, whatever now holds its pids.
    const startedAt = Date.parse(state.startedAt);
    if (Number.isFinite(startedAt) && startedAt < deps.bootTimeMs()) {
        forget();
        return { wasRunning: false, stale: true, services: [] };
    }
    const unverified = [];
    let ours = 0;
    let reused = 0;
    /** True only for a live pid whose start time still equals the one recorded when Flisk started it. */
    const isOurs = async (name, pid, recorded) => {
        if (!deps.isAlive(pid))
            return false;
        if (recorded === undefined) {
            unverified.push({ name, pid });
            return false;
        }
        const current = await deps.startTimeOf(pid);
        if (current === undefined) {
            unverified.push({ name, pid });
            return false;
        }
        if (current !== undefined && current === recorded) {
            ours += 1;
            return true;
        }
        reused += 1;
        return false;
    };
    // Identify the services before asking the supervisor to stop them, so the result also includes those it stops itself.
    const checks = await Promise.all(Object.entries(state.services).map(async ([name, service]) => service.pid !== undefined && (await isOurs(name, service.pid, service.startTime))
        ? { name, pid: service.pid, startTime: service.startTime }
        : undefined));
    if (state.pid !== process.pid && (await isOurs("flisk up", state.pid, state.pidStartTime))) {
        await deps.terminateSupervisor(state.pid, timeoutMs);
    }
    // The supervisor already stopped dependents first when it could; what is left has no order on record, so stop it together.
    await Promise.all(checks.map(async (service) => {
        if (service &&
            deps.isAlive(service.pid) &&
            (await deps.startTimeOf(service.pid)) === service.startTime) {
            await deps.stopGroup(service.pid, service.startTime);
        }
    }));
    forget();
    if (ours === 0 && reused > 0 && unverified.length === 0) {
        return { wasRunning: false, stale: true, services: [] };
    }
    return {
        wasRunning: ours > 0,
        services: checks.filter((service) => service !== undefined).map((service) => service.name),
        supervisorPid: state.pid,
        ...(unverified.length > 0 ? { unverified } : {}),
    };
}
/**
 * Asks the `flisk up` that supervises this project's local processes to restart one service, and waits for the outcome:
 * `ready`, `failed`, `timeout` (the service is still starting when `waitMs` passes), or `not-running` (no supervisor).
 * `waitMs: 0` returns as soon as the supervisor has accepted the request (`restarting`).
 */
export async function requestNativeRestart(projectRoot, service, options) {
    const run = readNativeRunState(projectRoot);
    if (!run || !isProcessAlive(run.pid)) {
        return { state: "not-running", reason: "no local processes of this project are running" };
    }
    const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = nativeControlDir(projectRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${id}.req.json`), JSON.stringify({ id, service }));
    const resultPath = join(dir, `${id}.res.json`);
    // Accepting a request takes a poll interval; deciding it takes the readiness check, which has its own timeout.
    const deadline = Date.now() + Math.max(options.waitMs, 0) + 5_000;
    let last;
    try {
        while (Date.now() < deadline) {
            try {
                last = JSON.parse(readFileSync(resultPath, "utf-8"));
            }
            catch {
                last = undefined;
            }
            if (last && (last.state !== "restarting" || options.waitMs === 0))
                return last;
            if (last && Date.now() >= deadline - 5_000) {
                return { state: "timeout", reason: "still starting when the wait ended" };
            }
            await sleep(100);
        }
        if (last)
            return { state: "timeout", reason: "still starting when the wait ended" };
        return {
            state: "failed",
            reason: "the supervisor did not answer; it may be busy or not a version that supports restart",
        };
    }
    finally {
        rmSync(join(dir, `${id}.req.json`), { force: true });
        rmSync(resultPath, { force: true });
    }
}
const CONTROL_POLL_MS = 250;
/** Writes the restart outcome the requester is polling for; a write failure means the requester times out. */
export function writeRestartResult(projectRoot, id, result) {
    try {
        const dir = nativeControlDir(projectRoot);
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, `${id}.res.json`), JSON.stringify(result));
    }
    catch {
        // The requester times out and reports it; the restart itself still ran.
    }
}
/** One sweep of the control directory: every well-formed `*.req.json` becomes one onRequest call. */
function pollRestartRequests(dir, isStopping, onRequest) {
    if (isStopping())
        return;
    let files;
    try {
        files = readdirSync(dir).filter((file) => file.endsWith(".req.json"));
    }
    catch {
        return;
    }
    for (const file of files) {
        const path = join(dir, file);
        let request;
        try {
            request = JSON.parse(readFileSync(path, "utf-8"));
        }
        catch {
            continue;
        }
        rmSync(path, { force: true });
        if (typeof request.id !== "string" || typeof request.service !== "string")
            continue;
        onRequest(request.service, request.id);
    }
}
/** Looks for restart requests from `flisk restart` (a separate process) a few times a second while the run is up. */
export function watchRestartRequests(dir, isStopping, onRequest) {
    const timer = setInterval(() => pollRestartRequests(dir, isStopping, onRequest), CONTROL_POLL_MS);
    timer.unref();
    return timer;
}
/**
 * Stops one service and starts it again from its current plan, then waits for its readiness check. Only this service is
 * touched; dependents keep running and are started again by the usual rules if they exit while it is down. The result is
 * written for the requester: `ready`, `failed` (it exited before it was ready), or `timeout`.
 */
export async function restartSupervisedService(host, name, id) {
    const finish = (result) => {
        writeRestartResult(host.projectRoot, id, result);
        return result;
    };
    const service = host.serviceNamed(name);
    if (!service) {
        return finish({ state: "failed", reason: `"${name}" is not part of this run` });
    }
    if (service.plan.container) {
        return finish({
            state: "failed",
            reason: `"${name}" runs as a container (docker run); restart the whole run with up and force`,
        });
    }
    if (service.restarting) {
        return finish({ state: "failed", reason: `"${name}" is already being restarted` });
    }
    service.restarting = true;
    writeRestartResult(host.projectRoot, id, { state: "restarting" });
    const startedAt = Date.now() - 1000;
    try {
        if (service.restartTimer)
            clearTimeout(service.restartTimer);
        service.restartTimer = undefined;
        const pid = service.child?.pid;
        if (pid && isChildRunning(service.child)) {
            await stopProcessGroup(pid, host.stopTimeoutMs);
        }
        // The fresh plan carries planning-time placeholders for values a migrator produced; bind them now.
        const kept = host.refreshPlan(service);
        if (kept !== undefined) {
            // The refreshed plan cannot be bound (an output that vanished): the kept note is true and the spawn
            // below uses the plan the run started with, not the half-bound refresh.
            host.note(name, `restart kept the previous plan: ${kept}`);
        }
        service.isReady = false;
        service.gaveUp = false;
        service.quickCrashes = 0;
        service.waitingFor = undefined;
        host.note(name, "restarting (requested)");
        host.spawn(service);
    }
    finally {
        // From here the normal exit handling applies again: a process that dies is retried by the usual policy.
        service.restarting = false;
    }
    const quietError = () => isQuietAfterStartupError(service, host.startupErrorQuietMs ?? STARTUP_ERROR_QUIET_MS);
    const ready = service.plan.job
        ? (await service.exited) === 0 && !host.isStopping()
        : await waitForServiceReady(service.plan, {
            isAlive: () => !host.isStopping() && isChildRunning(service.child) && !quietError(),
            timeoutMs: host.readyTimeoutMs,
        });
    if (ready) {
        service.isReady = true;
        host.saveState();
        host.note(name, "ready again");
        host.reprobe?.(service);
        host.resumed(name);
        return finish({ state: "ready", pid: service.child?.pid });
    }
    const exited = !isChildRunning(service.child);
    return finish({
        state: exited || quietError() ? "failed" : "timeout",
        reason: exited
            ? service.plan.job
                ? "the job did not exit 0"
                : "exited before it was ready"
            : quietError()
                ? STARTUP_ERROR_REASON
                : `not ready after ${Math.round((host.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS) / 1000)}s (${notReadyReason(service.plan)})`,
        logsSince: startedAt,
    });
}
