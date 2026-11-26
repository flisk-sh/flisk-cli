// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { clearMigratorOutputs } from "../migrator-output.js";
import { removeNativeContainers } from "../native-container.js";
import { appendNativeRunExit, appendNativeRunStart, latestNativeRunId, maxNativeLogSeq, } from "../native-log.js";
import { processStartTime } from "../process-identity.js";
import { createEnvRedactor, OUTPUT_WITHHELD, secretValuesFromEnv } from "../secret-redaction.js";
import { prepareJobRun, recordJobExit } from "./jobs.js";
import { pipeServiceStreams } from "./output.js";
import { DEFAULT_REPROBE_INTERVAL_MS, DEFAULT_REPROBE_RETRIES, dependencyWaves, detachesServices, resolvePlanLateValues, } from "./plan.js";
import { DEFAULT_READY_TIMEOUT_MS, isChildRunning, missingProgramNote, probeServiceReady, reprobeFailureReason, sleep, startFailureReason, waitForServiceReady, } from "./ready.js";
import { isQuietAfterStartupError, isStartupErrorLine, STARTUP_ERROR_QUIET_MS, STARTUP_ERROR_REASON, } from "./startup-error.js";
import { nativeControlDir, nativeLogPath, nativeRunStatePath, runServicesRecord, writeNativeRunState, } from "./state.js";
import { restartSupervisedService, shellInvocation, stopProcessGroup, watchRestartRequests, } from "./supervision.js";
/**
 * Starts and supervises the planned services. One instance per `flisk up`: it starts each service once its
 * dependencies are ready, restarts a process that exits under a growing delay (unless the service is a job or
 * sets `"restart": "no"`), answers restart requests, and records the run state `flisk down` works from.
 */
const MAX_QUICK_CRASHES = 8;
const DEFAULT_RESTART_DELAY_MS = 250;
const MAX_RESTART_DELAY_MS = 5_000;
/** A process that ran at least this long before exiting crashed "slowly": its restart delay starts over. */
/** How often startup checks for the next process after one exited before it was ready. */
const STARTUP_RETRY_POLL_MS = 25;
const QUICK_CRASH_MS = 10_000;
/**
 * Delay before the retry after `crashCount` consecutive quick crashes (#3820). Doubling starts small so a service waiting on
 * another one to become ready is not held back by a full second, but stops at 5s so repeated failures stay bounded.
 */
export function restartDelayForCrash(crashCount, baseMs = DEFAULT_RESTART_DELAY_MS) {
    return Math.min(MAX_RESTART_DELAY_MS, baseMs * 2 ** (crashCount - 1));
}
export class NativeSupervisor {
    projectRoot;
    events;
    options;
    services = new Map();
    /** Known size of each service log, shared by its stdout and stderr writers, for rotation (#3720). */
    logSizes = new Map();
    /** Last run id handed out per service; seeded from the log files so a new `up` continues the sequence (#4693). */
    runIds = new Map();
    migratorOutputs = new Map();
    /** Redacts one line of service output; rebuilt from the active plans whenever a restart reloads them. */
    redactLine;
    /**
     * Plan secrets seen so far. A restart reloads only its own plan, while the other services keep running with the
     * values they started with, so the redactor only ever grows: it never forgets a secret a live process may print.
     */
    planSecrets = new Set();
    startedAt = new Date().toISOString();
    /** One counter for every service in the project, resumed from the logs when a previous supervisor wrote them. */
    seq = { value: 0 };
    pidStartTime;
    stopping = false;
    optionalFailuresList = [];
    baseEnv;
    controlTimer;
    restartHost;
    constructor(projectRoot, plans, events = {}, options = {}) {
        this.projectRoot = projectRoot;
        this.events = events;
        this.options = options;
        this.baseEnv = options.baseEnv;
        this.redactLine = this.buildRedactor(plans);
        this.seq.value = maxNativeLogSeq(plans.flatMap((plan) => [
            nativeLogPath(projectRoot, plan.name),
            `${nativeLogPath(projectRoot, plan.name)}.1`,
        ]));
        for (const plan of plans) {
            this.services.set(plan.name, {
                plan,
                startedAt: 0,
                quickCrashes: 0,
                gaveUp: false,
                isReady: false,
                reprobeFailures: 0,
                lastExitCode: null,
            });
        }
        this.restartHost = {
            projectRoot,
            serviceNamed: (name) => this.services.get(name),
            isStopping: () => this.stopping,
            stopTimeoutMs: options.stopTimeoutMs,
            readyTimeoutMs: options.readyTimeoutMs,
            startupErrorQuietMs: options.startupErrorQuietMs,
            refreshPlan: (service) => this.refreshServicePlan(service),
            spawn: (service) => this.spawn(service),
            saveState: () => this.saveState(),
            note: (name, message) => this.events.onNote?.(name, message),
            resumed: (name) => this.resumeDependents(name),
            reprobe: (service) => this.startReprobe(service),
        };
    }
    /**
     * The redactor for the plans that are about to run. Local overrides are applied to the plans, not
     * written to service.json, so the discovery-based redactor cannot see them: their secret-named
     * env values are masked with the same rules (including ${VAR} expansions and multiline values kept
     * line by line) before any output is written.
     */
    buildRedactor(plans) {
        for (const plan of plans) {
            for (const value of [...secretValuesFromEnv(plan.rawEnv), ...secretValuesFromEnv(plan.env)]) {
                this.planSecrets.add(value);
            }
        }
        return createEnvRedactor(this.projectRoot, this.options.extraEnvPaths, [...this.planSecrets]);
    }
    /** The width service names are padded to in prefixed output. */
    get prefixWidth() {
        return Math.max(...[...this.services.keys()].map((name) => name.length));
    }
    /**
     * Waits for one startup attempt of a service: its probe, or a full grace period with the *same* process alive. A process
     * that exits inside the grace is a failed attempt, so its restart gets a fresh wait instead of inheriting this one (#3950).
     */
    async waitForStartup(service) {
        const deadline = Date.now() + (this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
        for (;;) {
            if (this.stopping || service.gaveUp || Date.now() >= deadline)
                return service.isReady;
            const child = service.child;
            if (!isChildRunning(child)) {
                // A "restart": "no" service that already exited 0 has finished: ready without waiting for a port it will
                // never serve (#5120).
                if (service.isReady)
                    return true;
                // A restart is pending, or a dependency may revive this one: keep the startup wait alive until the timeout.
                if (service.restartTimer || service.waitingFor) {
                    await sleep(STARTUP_RETRY_POLL_MS);
                    continue;
                }
                return false;
            }
            const ready = await waitForServiceReady(service.plan, {
                // Capture this process: a quick restart must not be mistaken for the one that survived the grace period.
                isAlive: () => !this.stopping &&
                    !service.gaveUp &&
                    service.child === child &&
                    isChildRunning(child) &&
                    !this.isQuietAfterError(service),
                timeoutMs: Math.max(1, deadline - Date.now()),
                onStatus: (status) => {
                    service.readyStatus = status;
                },
                isFinished: () => service.isReady,
            });
            if (ready)
                return true;
            if (this.stopping || service.gaveUp || Date.now() >= deadline)
                return service.isReady;
            if (service.child === child && isChildRunning(child))
                return false; // A probe timed out while the process stayed up.
            await sleep(STARTUP_RETRY_POLL_MS);
        }
    }
    /**
     * Starts every service once its dependencies are ready. Resolves with the services that never became ready (empty when the
     * whole selection is up); a service whose dependency failed is reported as blocked and never started.
     */
    async start() {
        this.saveState();
        // Persist the supervisor identity before startup can report success; otherwise an immediate `down` cannot verify it.
        this.pidStartTime = await this.readStartTime(process.pid);
        if (this.stopping)
            return [];
        this.saveState();
        this.startControlLoop();
        const plans = [...this.services.values()].map((service) => service.plan);
        const ready = new Map();
        const failures = [];
        for (const name of dependencyWaves(plans).flat()) {
            const service = this.services.get(name);
            ready.set(name, (async () => {
                const deps = await Promise.all(service.plan.dependsOn.map((dep) => ready.get(dep)));
                if (!deps.every(Boolean)) {
                    const blockedBy = service.plan.dependsOn.filter((_dep, index) => !deps[index]);
                    // It never got a process, but it is not restarting: remember what held it back so status can name it (#3805).
                    service.waitingFor = blockedBy;
                    this.saveState();
                    failures.push({
                        name,
                        reason: `not started: ${blockedBy.join(", ")} did not start`,
                        exitCode: null,
                    });
                    return false;
                }
                if (this.stopping)
                    return false;
                // An explicit `service_healthy` waits for the probe to pass, so an optional dependency that was accepted
                // with a failing probe does not release this dependent.
                const unhealthy = (service.plan.healthyDeps ?? []).filter((dep) => this.services.get(dep)?.optionalAccepted);
                if (unhealthy.length > 0) {
                    failures.push({
                        name,
                        reason: `not started: ${unhealthy.join(", ")} did not pass its health check`,
                        exitCode: null,
                    });
                    return false;
                }
                try {
                    this.resolveServiceEnv(service);
                }
                catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    failures.push({ name, reason, exitCode: null });
                    return false;
                }
                this.spawn(service);
                // A one-shot job is ready when it has run to completion with exit code 0.
                const isReady = service.plan.job
                    ? (await service.exited) === 0 && !this.stopping
                    : await this.waitForStartup(service);
                await service.identityReady;
                if (isReady) {
                    service.isReady = true;
                    this.saveState();
                    this.events.onNote?.(name, "ready");
                    this.startReprobe(service);
                    this.resumeDependents(name);
                }
                else if (!this.stopping) {
                    const exit = service.lastExit;
                    // Machine callers never saw the service's output, so the pointer to "its output above" is dropped.
                    const reason = (this.isQuietAfterError(service)
                        ? STARTUP_ERROR_REASON
                        : !service.plan.job && !service.gaveUp && !isChildRunning(service.child) && exit
                            ? `${exit.signal ? `was stopped by ${exit.signal}` : `exited with code ${exit.code}`} before it was ready; see its output above`
                            : startFailureReason(service.plan, service.gaveUp, service.lastExitCode, this.options.readyTimeoutMs)).replace("; see its output above", "");
                    // Only a process that is still running with a failing probe is accepted; one that exited and waits for its restart blocks.
                    if (service.plan.healthCheckOptional &&
                        !service.plan.job &&
                        !service.gaveUp &&
                        !this.isQuietAfterError(service) &&
                        isChildRunning(service.child)) {
                        service.optionalAccepted = true;
                        this.optionalFailuresList.push({ name, reason });
                        this.events.onNote?.(name, `optional health check failed (${reason}); continuing without blocking`);
                        return true;
                    }
                    failures.push({ name, reason, exitCode: service.lastExitCode ?? null });
                }
                return isReady;
            })());
        }
        await Promise.all(ready.values());
        return failures;
    }
    /**
     * Stops every service, dependents before what they depend on, and removes the run state. Services of one wave do not depend
     * on each other, so they get their SIGTERM grace period at the same time (#3811).
     */
    async stop() {
        if (this.stopping)
            return;
        this.stopping = true;
        if (this.controlTimer)
            clearInterval(this.controlTimer);
        rmSync(nativeControlDir(this.projectRoot), { recursive: true, force: true });
        const waves = dependencyWaves([...this.services.values()].map((s) => s.plan)).reverse();
        for (const wave of waves) {
            await Promise.all(wave.map(async (name) => {
                const service = this.services.get(name);
                if (service.restartTimer)
                    clearTimeout(service.restartTimer);
                this.stopReprobe(service);
                const pid = service.child?.pid;
                if (pid && service.child?.exitCode === null && service.child.signalCode === null) {
                    await stopProcessGroup(pid, this.options.stopTimeoutMs);
                }
            }));
        }
        if ([...this.services.values()].some((service) => service.plan.container)) {
            removeNativeContainers(this.projectRoot);
        }
        rmSync(nativeRunStatePath(this.projectRoot), { force: true });
        clearMigratorOutputs(this.projectRoot);
    }
    /** The current process id of a service, for tests and diagnostics. */
    pidOf(name) {
        return this.services.get(name)?.child?.pid;
    }
    /** HTTP readiness status codes recorded per service during startup. */
    readyStatuses() {
        const statuses = new Map();
        for (const [name, service] of this.services) {
            if (service.readyStatus !== undefined) {
                statuses.set(name, service.readyStatus);
            }
        }
        return statuses;
    }
    /** Services with `healthCheck.required: false` whose health checks failed without blocking startup. */
    optionalFailures() {
        return [...this.optionalFailuresList];
    }
    /** Parsed outputs produced by finished migrators (for inspection and tests). */
    outputsOf(migratorName) {
        return this.migratorOutputs.get(migratorName);
    }
    /**
     * True when the service wrote a startup-error line and then nothing for the quiet window while its
     * readiness probe still fails: a watcher is holding the crashed app's process, so the wait ends
     * early instead of running the whole timeout (#5038).
     */
    isQuietAfterError(service) {
        return isQuietAfterStartupError(service, this.options.startupErrorQuietMs ?? STARTUP_ERROR_QUIET_MS);
    }
    resolveServiceEnv(service) {
        const outputsRecord = {};
        for (const [k, v] of this.migratorOutputs) {
            outputsRecord[k] = v;
        }
        resolvePlanLateValues(service.plan, outputsRecord, this.baseEnv ?? process.env);
        // The resolved migrator output is the value the process receives, and only now is it known: a secret-named key
        // (API_TOKEN=${migrator:KEY}) holds the reference text in the plan until here.
        this.redactLine = this.buildRedactor([service.plan]);
    }
    /** The next short, per-service run id, surviving a supervisor restart through the markers in the log files. */
    nextRunId(name, path) {
        const last = latestNativeRunId(path);
        const next = Math.max(this.runIds.get(name) ?? 0, last === null ? 0 : Number(last) || 0) + 1;
        this.runIds.set(name, next);
        return String(next);
    }
    /** A full disk must not turn a run marker into a reason for the service to stop. */
    writeRunStart(path, runId, pid) {
        try {
            appendNativeRunStart(path, runId, pid, this.logSizes);
        }
        catch {
            // The terminal note and the service still work without the marker.
        }
    }
    writeRunExit(path, runId, code) {
        try {
            appendNativeRunExit(path, runId, code, this.logSizes);
        }
        catch {
            // The terminal note and the service still work without the marker.
        }
    }
    spawn(service) {
        const { plan } = service;
        const logPath = nativeLogPath(this.projectRoot, plan.name);
        if (plan.job)
            prepareJobRun(this.projectRoot, plan, this.migratorOutputs);
        service.startedAt = Date.now();
        // A fresh start forgets what the last process wrote: its error line must not mark this one's output.
        service.lastOutputAt = service.startedAt;
        service.sawStartupError = false;
        // An accepted failing probe belongs to the process that failed it: a replacement child (restart, respawn) must
        // pass the readiness check its current plan asks for before it stops holding dependents back.
        service.optionalAccepted = false;
        // `command` is a shell command line the project owner wrote in their own service.json (`PORT=1 node s.js`, `$PORT`,
        // `a && b`), run with the same trust as an npm script or a Procfile entry; nothing from outside the project reaches it.
        const shell = shellInvocation(plan.command);
        const child = spawn(shell.file, shell.args, {
            cwd: plan.cwd,
            env: { ...(this.baseEnv ?? process.env), ...plan.env },
            windowsVerbatimArguments: shell.windowsVerbatimArguments,
            // Its own process group, so a stop reaches what the shell started too, and a Ctrl+C in the terminal reaches only
            // `flisk up`, which then stops the services in order. Not on Windows: see detachesServices.
            detached: detachesServices(),
            stdio: ["ignore", "pipe", "pipe"],
            // Without this a console window opens for every service (and every restart) when flisk runs without a console of its own.
            windowsHide: true,
        });
        service.child = child;
        service.startTime = undefined;
        service.lastExit = undefined;
        service.identityReady = undefined;
        const pid = child.pid;
        const runId = this.nextRunId(plan.name, logPath);
        this.writeRunStart(logPath, runId, pid);
        let exitRecorded = false;
        // Both a normal exit and a spawn error close the run; recording once avoids two markers when Node emits both.
        const recordExit = (code) => {
            if (exitRecorded)
                return;
            exitRecorded = true;
            this.writeRunExit(logPath, runId, code);
        };
        if (pid !== undefined) {
            service.identityReady = this.readStartTime(pid).then((startTime) => {
                // Saved only while this is still the service's process: a restart in the meantime reads its own.
                if (this.stopping || service.child !== child || startTime === undefined)
                    return;
                service.startTime = startTime;
                this.saveState();
            });
        }
        service.exited = new Promise((resolve) => {
            child.once("exit", (code) => {
                recordExit(code);
                resolve(code);
            });
            child.once("error", () => {
                recordExit(null);
                resolve(null);
            });
        });
        // The note shows the command line. A value that env expansion put into a container's words is a secret as soon
        // as it is displayed, so the note is redacted like service output; a redaction failure withholds the text
        // instead of stopping the service from starting. A local line shows the author's own service.json text.
        let startedNote;
        try {
            startedNote = this.redactLine(`started: ${plan.command}${child.pid ? ` (pid ${child.pid})` : ""}`);
        }
        catch {
            startedNote = `started: ${OUTPUT_WITHHELD}`;
        }
        this.events.onNote?.(plan.name, startedNote);
        pipeServiceStreams(plan.name, child, {
            logPath,
            seq: this.seq,
            isCurrentRun: () => service.child === child,
            logSizes: this.logSizes,
            redactLine: this.redactLine,
            onLine: (name, line, stream) => {
                service.lastOutputAt = Date.now();
                if (!service.sawStartupError && isStartupErrorLine(line)) {
                    service.sawStartupError = true;
                }
                this.events.onLine?.(name, line, stream);
            },
            onNote: this.events.onNote,
        });
        child.once("error", (error) => {
            this.events.onNote?.(plan.name, `could not start: ${error.message}`);
        });
        child.once("exit", (code, signal) => this.onExit(service, child, code, signal));
        this.saveState();
    }
    onExit(service, child, code, signal) {
        if (this.stopping || service.child !== child || service.restarting)
            return;
        this.stopReprobe(service);
        service.isReady = false;
        service.lastExitCode = code;
        service.lastExit = { code, signal };
        this.saveState();
        const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
        if (service.plan.job) {
            const notes = recordJobExit(this.projectRoot, service, code, how, this.migratorOutputs);
            this.saveState();
            for (const note of notes)
                this.events.onNote?.(service.plan.name, note);
            return;
        }
        if (!service.plan.restart) {
            // A "restart": "no" service that exits 0 has simply finished: a one-shot under another appType, or with a
            // port it never serves. Not a failure, and its dependents can start (#5120). A non-zero exit is a failure.
            service.gaveUp = code !== 0;
            service.isReady = code === 0;
            this.saveState();
            this.events.onNote?.(service.plan.name, `${how}; not restarting ("restart": "no")`);
            return;
        }
        // Exiting because a database or API it needs went away is not the service's own crash: wait for it instead of giving up.
        const down = this.dependenciesDown(service);
        if (down.length > 0) {
            service.quickCrashes = 0;
            service.waitingFor = down;
            this.saveState();
            this.events.onNote?.(service.plan.name, `${how} while ${down.join(", ")} ${down.length === 1 ? "is" : "are"} down; starts again once ${down.length === 1 ? "it is" : "they are"} ready`);
            return;
        }
        const ranFor = Date.now() - service.startedAt;
        service.quickCrashes = ranFor < QUICK_CRASH_MS ? service.quickCrashes + 1 : 1;
        // Exit code 127 is the shell's "command not found": say so as soon as it happens, so the first exit
        // already names the program to install instead of only the give-up note (#4678).
        const missing = service.lastExitCode === 127 ? missingProgramNote(service.plan) : "";
        if (service.quickCrashes >= MAX_QUICK_CRASHES) {
            service.gaveUp = true;
            this.events.onNote?.(service.plan.name, `${how}${missing}; it exited ${MAX_QUICK_CRASHES} times in a row, so it is not restarted. Fix it, then run flisk up again.`);
            return;
        }
        const delay = restartDelayForCrash(service.quickCrashes, this.options.restartDelayMs);
        this.events.onNote?.(service.plan.name, `${how}${missing}; restarting in ${delay / 1000}s`);
        service.restartTimer = setTimeout(() => this.respawn(service), delay);
    }
    /** Starts a service again after it exited, and reports when it is ready again. */
    respawn(service) {
        service.restartTimer = undefined;
        if (this.stopping)
            return;
        this.spawn(service);
        const child = service.child;
        void waitForServiceReady(service.plan, {
            // A newer restart is a different attempt, not proof that this one survived its grace period.
            isAlive: () => !this.stopping &&
                service.child === child &&
                isChildRunning(child) &&
                !this.isQuietAfterError(service),
            timeoutMs: this.options.readyTimeoutMs,
        }).then(async (isReady) => {
            await service.identityReady;
            if (!isReady || this.stopping)
                return;
            service.isReady = true;
            this.saveState();
            this.events.onNote?.(service.plan.name, "ready again");
            this.startReprobe(service);
            this.resumeDependents(service.plan.name);
        });
    }
    /**
     * Re-probe an already-ready local process with the very same readiness signal used at startup (#4692). Containers keep their
     * Compose health check and one-shot jobs have nothing to probe after they finish.
     */
    startReprobe(service) {
        this.stopReprobe(service);
        if (this.stopping ||
            service.plan.healthCheckDisabled ||
            service.plan.job ||
            service.plan.container) {
            return;
        }
        const settings = service.plan.reprobe ?? {
            intervalMs: DEFAULT_REPROBE_INTERVAL_MS,
            retries: DEFAULT_REPROBE_RETRIES,
            onFailure: "report",
        };
        service.reprobeTimer = setInterval(() => {
            void this.reprobeOnce(service, settings);
        }, settings.intervalMs);
        service.reprobeTimer.unref();
    }
    stopReprobe(service) {
        if (service.reprobeTimer)
            clearInterval(service.reprobeTimer);
        service.reprobeTimer = undefined;
    }
    async reprobeOnce(service, settings) {
        if (this.stopping || service.restarting || !isChildRunning(service.child))
            return;
        const child = service.child;
        const status = await probeServiceReady(service.plan);
        // A restart or exit happened while the probe was in flight: its answer belongs to the old process.
        if (this.stopping || service.child !== child || !isChildRunning(service.child))
            return;
        if (status !== null) {
            if (service.reprobeFailures === 0 && !service.unhealthyReason)
                return;
            service.reprobeFailures = 0;
            service.unhealthyReason = undefined;
            service.isReady = true;
            this.saveState();
            this.events.onNote?.(service.plan.name, "ready again");
            this.resumeDependents(service.plan.name);
            return;
        }
        service.reprobeFailures += 1;
        // One note and one action per unhealthy episode: keep probing so a single success can return it to ready.
        if (service.reprobeFailures < Math.max(1, settings.retries) || service.unhealthyReason)
            return;
        const reason = reprobeFailureReason(service.plan, service.reprobeFailures);
        service.unhealthyReason = reason;
        service.isReady = false;
        this.saveState();
        this.events.onNote?.(service.plan.name, `unhealthy: ${reason}`);
        if (settings.onFailure === "restart" && service.plan.restart) {
            this.restartUnhealthy(service, reason);
        }
    }
    /** Restarts an unhealthy process under the same MAX_QUICK_CRASHES limit as a process that exits. */
    restartUnhealthy(service, reason) {
        this.stopReprobe(service);
        const ranFor = Date.now() - service.startedAt;
        service.quickCrashes = ranFor < QUICK_CRASH_MS ? service.quickCrashes + 1 : 1;
        if (service.quickCrashes >= MAX_QUICK_CRASHES) {
            service.gaveUp = true;
            this.saveState();
            this.events.onNote?.(service.plan.name, `${reason}; it was unhealthy ${MAX_QUICK_CRASHES} times in a row, so it is not restarted. Fix it, then run flisk up again.`);
            return;
        }
        const delay = restartDelayForCrash(service.quickCrashes, this.options.restartDelayMs);
        this.events.onNote?.(service.plan.name, `unhealthy (${reason}); restarting in ${delay / 1000}s`);
        service.restartTimer = setTimeout(() => {
            service.restartTimer = undefined;
            if (this.stopping)
                return;
            service.restarting = true;
            const child = service.child;
            void (async () => {
                try {
                    const pid = child?.pid;
                    if (pid && isChildRunning(child))
                        await stopProcessGroup(pid, this.options.stopTimeoutMs);
                    if (!this.stopping)
                        this.respawn(service);
                }
                finally {
                    // The old process's exit is expected: onExit ignores it while `restarting` is set.
                    service.restarting = false;
                }
            })();
        }, delay);
    }
    /**
     * The dependencies of this run that are not ready now but may come back (restarting, or waiting themselves). One that gave up
     * never comes back, so a dependent is not made to wait for it: it counts its crashes and gives up with a visible message.
     */
    dependenciesDown(service) {
        return service.plan.dependsOn.filter((dep) => {
            const other = this.services.get(dep);
            if (other === undefined || other.isReady || other.gaveUp)
                return false;
            // An optional service that runs with a failing probe does not hold its dependents back, as at startup.
            // An explicit `service_healthy` edge still waits for the probe.
            const waitsForProbe = service.plan.healthyDeps?.includes(dep) ?? false;
            return waitsForProbe || !(other.optionalAccepted && isChildRunning(other.child));
        });
    }
    /**
     * `name` became ready again: start each dependent that exited while it was down, and give a fresh start to one that stopped
     * restarting (it may have crashed before the supervisor saw the dependency go).
     */
    resumeDependents(name) {
        for (const service of this.services.values()) {
            if (this.stopping || !service.plan.dependsOn.includes(name))
                continue;
            if (service.plan.job || !service.plan.restart)
                continue;
            if (!service.waitingFor && !service.gaveUp)
                continue;
            if (service.restartTimer || isChildRunning(service.child))
                continue;
            if (this.dependenciesDown(service).length > 0)
                continue;
            service.waitingFor = undefined;
            service.gaveUp = false;
            service.quickCrashes = 0;
            this.events.onNote?.(service.plan.name, `${name} is ready again; starting`);
            this.respawn(service);
        }
    }
    readStartTime(pid) {
        return (this.options.startTimeOf ?? processStartTime)(pid).catch(() => undefined);
    }
    /** Looks for restart requests from `flisk restart` (a separate process) a few times a second while the run is up. */
    startControlLoop() {
        if (this.controlTimer)
            return;
        this.controlTimer = watchRestartRequests(nativeControlDir(this.projectRoot), () => this.stopping, (service, id) => {
            void this.restartService(service, id);
        });
    }
    /**
     * Stops one service and starts it again from its current plan, then waits for its readiness check. Only this service is
     * touched; dependents keep running and are started again by the usual rules if they exit while it is down. The result is
     * written for the requester: `ready`, `failed` (it exited before it was ready), or `timeout`.
     */
    async restartService(name, id) {
        return restartSupervisedService(this.restartHost, name, id);
    }
    /**
     * Reloads the service's plan and binds its late values for a requested restart. Returns the reason the previous
     * plan was kept, when the refreshed plan could not be bound.
     */
    refreshServicePlan(service) {
        const previousPlan = service.plan;
        const previousBaseEnv = this.baseEnv;
        this.refreshPlans(service);
        try {
            this.resolveServiceEnv(service);
        }
        catch (err) {
            service.plan = previousPlan;
            this.baseEnv = previousBaseEnv;
            return err instanceof Error ? err.message : String(err);
        }
        return undefined;
    }
    /** A restart starts from the .env and plan as they are now, so a repaired value takes effect. */
    refreshPlans(service) {
        const reload = this.options.reload;
        if (!reload)
            return;
        try {
            const { plans, baseEnv } = reload();
            const fresh = plans.find((plan) => plan.name === service.plan.name);
            if (!fresh)
                return;
            service.plan = fresh;
            this.baseEnv = baseEnv;
            // The restarted process writes with the fresh plan's env, so the redaction must follow it: a
            // local override changed since start (or one the reload re-read) must not start leaking.
            this.redactLine = this.buildRedactor(plans);
        }
        catch {
            // An unreadable env file keeps the plan the run started with.
        }
    }
    saveState() {
        writeNativeRunState(this.projectRoot, {
            pid: process.pid,
            ...(this.pidStartTime ? { pidStartTime: this.pidStartTime } : {}),
            startedAt: this.startedAt,
            services: runServicesRecord(this.services),
        });
    }
}
