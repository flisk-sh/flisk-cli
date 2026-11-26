// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFile } from "node:child_process";
import { composeProjectName } from "./container-restart.js";
import { dependsOnOf } from "./dependency-graph.js";
import { getDeferredResourceNames } from "./doctor-runtime.js";
import { resolveRuntimeTiltPort } from "./host-port-config.js";
import { isProcessAlive, nativeServiceStates, readNativeRunState, } from "./native-runtime.js";
import { isNativeProject } from "./native-service.js";
import { findProjectRoot } from "./paths.js";
import { redactProjectText } from "./secret-redaction.js";
import { deriveServiceStates } from "./service-runtime-state.js";
import { discoverResourcesFromRoot } from "./services.js";
import { capEnd } from "./startup-logs.js";
import { effectiveRuntimeStatus, UNHEALTHY_CONTAINER_MESSAGE } from "./tilt-resource-state.js";
import { tiltGetUiResources } from "./up-readiness.js";
import { findOnPath } from "./which.js";
/** Docker inspects are bounded the way `machineProblemFixes` bounds log reads: the first few answers carry the cause. */
const MAX_CONTAINER_INSPECTS = 5;
/** The services not healthy, in report order: the names `data.unhealthy` carries. */
export function unhealthyWaitServiceNames(entries) {
    return entries.filter((entry) => entry.status !== "healthy").map((entry) => entry.name);
}
/**
 * The last output line of the newest probe that printed anything, or null. Docker keeps the last five
 * `State.Health.Log` entries; the newest non-empty one is "the last health probe line" the issue asks for.
 */
function lastProbeOutput(log) {
    for (let index = log.length - 1; index >= 0; index--) {
        const lines = (log[index]?.Output ?? "")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length > 0)
            return capEnd(lines[lines.length - 1]);
    }
    return null;
}
/**
 * `docker inspect` on the service's compose container (`-a`, so an exited container still answers), scoped
 * by the project's own Compose project name so another project's `db` cannot answer. More than one
 * container with the labels, or Docker not answering, is "no answer": the entry keeps its reason.
 */
export function inspectServiceContainer(service, composeProject, cwd) {
    return new Promise((resolve) => {
        const docker = findOnPath("docker") ?? "docker";
        execFile(docker, [
            "ps",
            "-aq",
            "--filter",
            `label=com.docker.compose.project=${composeProject}`,
            "--filter",
            `label=com.docker.compose.service=${service}`,
        ], { encoding: "utf-8", timeout: 8000 }, (error, stdout) => {
            const id = String(stdout ?? "")
                .split("\n")
                .filter(Boolean)[0];
            if (error || !id)
                return resolve(null);
            execFile(docker, ["inspect", "--format", "{{json .State}}", id], {
                encoding: "utf-8",
                timeout: 8000,
                maxBuffer: 4 * 1024 * 1024,
            }, (inspectError, output) => {
                if (inspectError)
                    return resolve(null);
                try {
                    const state = JSON.parse(String(output));
                    const probeOutput = lastProbeOutput(state.Health?.Log ?? []);
                    resolve({
                        exitCode: typeof state.ExitCode === "number" ? state.ExitCode : null,
                        // A probe runs the service's own commands, so its output is masked like a log line.
                        probeOutput: probeOutput === null ? null : redactProjectText(probeOutput, cwd),
                    });
                }
                catch {
                    resolve(null);
                }
            });
        });
    });
}
function tiltRawItems(jsonText) {
    const items = JSON.parse(jsonText).items;
    const out = new Map();
    for (const item of items ?? []) {
        const name = item.metadata?.name;
        if (!name || name === "(Tiltfile)")
            continue;
        out.set(name, {
            updateStatus: item.status?.updateStatus ?? "",
            runtimeStatus: item.status?.runtimeStatus ?? "",
            effective: effectiveRuntimeStatus(item.status),
            healthStatus: item.status?.composeResourceInfo?.healthStatus,
        });
    }
    return out;
}
function tiltReportNames(names, states, only) {
    const wanted = new Set(only ?? []);
    return names.filter((name) => states[name] !== undefined || wanted.has(name));
}
/**
 * One entry per service the Tilt run knew about. An `--only` selection adds the names it asked for even
 * when Tilt never got to them. Resources that are services of the project but not services the run started
 * (a profile kept out, a resource Tilt disabled) have no state and are left out.
 */
export function tiltServiceHealth(jsonText, names, dependsOn, deferred, only) {
    const raw = tiltRawItems(jsonText);
    const states = deriveServiceStates(jsonText, dependsOn, deferred);
    const entries = [];
    const probe = new Set();
    const exited = new Set();
    for (const name of tiltReportNames(names, states, only)) {
        const state = states[name];
        const item = raw.get(name);
        if (!state) {
            entries.push({ name, status: "unhealthy", reason: "not running" });
            continue;
        }
        // A deferred resource idles on purpose (it starts on its first request): it is not a wait failure.
        if (state.status === "unknown")
            continue;
        // With no build error to summarize, a failure's reason is just the "<update>/<runtime>" status pair:
        // noise next to the exit code or probe line, so it does not count as a reason.
        const statusPair = item ? `${item.updateStatus}/${item.effective}` : "";
        const reason = state.reason && state.reason !== statusPair ? state.reason : undefined;
        // A stopped container (runtime error after a clean build) is `exited`; a failed build is `unhealthy`.
        if (item?.runtimeStatus === "error" && item.updateStatus !== "error") {
            exited.add(name);
            entries.push({
                name,
                status: "exited",
                ...(reason ? { reason } : {}),
                ...(state.blockedBy ? { blockedBy: state.blockedBy } : {}),
            });
            continue;
        }
        if (state.status === "ready") {
            entries.push({ name, status: "healthy" });
            continue;
        }
        if (item?.runtimeStatus === "ok" && item.healthStatus === "unhealthy")
            probe.add(name);
        entries.push({
            name,
            status: "unhealthy",
            reason: reason ?? (state.status === "pending" ? "starting" : "failed"),
            ...(state.blockedBy ? { blockedBy: state.blockedBy } : {}),
        });
    }
    return { entries, probe, exited };
}
/**
 * The services of a local-process run that ran this time, each classified. A service the supervisor gave
 * up on (`failed`) and a one-shot job that exited non-zero are `exited`; a record still restarting or
 * waiting on a dependency is `unhealthy`. Nothing else ran means nothing to report.
 */
export function nativeServiceHealth(states, run, names, isAlive) {
    const entries = [];
    for (const name of names) {
        const record = run?.services[name];
        const state = states[name];
        if (!state)
            continue;
        // A service the supervisor gave up on, or a one-shot job that did not exit 0, is `exited`.
        const died = record?.failed === true ||
            (record?.job === true && record.ready !== true && (!record.pid || !isAlive(record.pid)));
        if (died) {
            entries.push({
                name,
                status: "exited",
                ...(state.reason ? { reason: state.reason } : {}),
            });
            continue;
        }
        if (state.status === "ready") {
            entries.push({ name, status: "healthy" });
            continue;
        }
        entries.push({
            name,
            status: "unhealthy",
            reason: state.reason ?? "not running",
            ...(record?.waitingFor?.length
                ? { blockedBy: record.waitingFor }
                : state.blockedBy
                    ? { blockedBy: state.blockedBy }
                    : {}),
        });
    }
    return entries;
}
/**
 * Reasons a container record still improves: an `exited` entry gains its exit code ("exited with code 1",
 * appended to a reason the log already gave), and a health-check failure keeps the last probe's own output
 * when the reason so far is only the generic "container is running, but its health check is failing".
 */
export async function enrichContainerReasons(entries, probe, exited, inspect) {
    const out = [];
    let inspected = 0;
    for (const entry of entries) {
        const wants = probe.has(entry.name) || exited.has(entry.name);
        if (!wants || inspected >= MAX_CONTAINER_INSPECTS) {
            out.push(entry);
            continue;
        }
        inspected += 1;
        const state = await inspect(entry.name);
        if (exited.has(entry.name) && state?.exitCode != null) {
            const code = `exit code ${state.exitCode}`;
            out.push({
                ...entry,
                reason: entry.reason ? `${entry.reason} (${code})` : `exited with code ${state.exitCode}`,
            });
            continue;
        }
        if (probe.has(entry.name) && state?.probeOutput) {
            const generic = entry.reason === undefined || entry.reason === UNHEALTHY_CONTAINER_MESSAGE;
            out.push(generic ? { ...entry, reason: `health check failing: ${state.probeOutput}` } : entry);
            continue;
        }
        out.push(entry);
    }
    return out;
}
/** Reasons a preferred failure message still improves: the placeholders a state classifier writes on its own. */
const GENERIC_REASONS = new Set([
    UNHEALTHY_CONTAINER_MESSAGE,
    "starting",
    "not running",
    "not ready",
    "failed",
]);
function withPreferredReasons(entries, preferReasons) {
    if (!preferReasons || preferReasons.size === 0)
        return entries;
    return entries.map((entry) => {
        const preferred = preferReasons.get(entry.name);
        const generic = entry.reason === undefined || GENERIC_REASONS.has(entry.reason);
        return entry.status !== "healthy" && preferred !== undefined && generic
            ? { ...entry, reason: preferred }
            : entry;
    });
}
export const defaultUpWaitHealthDeps = {
    projectRoot: (cwd) => findProjectRoot(cwd),
    discover: (root) => discoverResourcesFromRoot(root),
    isNative: isNativeProject,
    nativeRun: (root) => readNativeRunState(root),
    nativeStates: (root, names) => nativeServiceStates(root, names),
    isAlive: (pid) => isProcessAlive(pid),
    dependsOn: (resources) => Object.fromEntries(resources.map((resource) => [resource.name, dependsOnOf(resource.config)])),
    deferred: (resources) => getDeferredResourceNames(resources),
    tiltPort: (root) => resolveRuntimeTiltPort(root, { envPort: process.env.TILT_PORT }),
    fetchJson: (port) => tiltGetUiResources(port),
    containerState: (service, project, cwd) => inspectServiceContainer(service, project, cwd),
};
/**
 * The `up --wait --json` per-service report for a wait that did not succeed. Resolves the project from
 * `cwd`, reads the local-process run state or Tilt's resource list the same way `flisk status` does, and
 * answers `[]` when no project or stack state can be found (the result then keeps its failures only).
 */
export async function upWaitServiceHealth(options, deps = defaultUpWaitHealthDeps) {
    const root = deps.projectRoot(options.cwd);
    if (!root)
        return [];
    let resources;
    try {
        resources = deps.discover(root);
    }
    catch {
        return [];
    }
    const names = resources.map((resource) => resource.name);
    if (names.length === 0)
        return [];
    let entries;
    if (deps.isNative(resources)) {
        entries = nativeServiceHealth(deps.nativeStates(root, names), deps.nativeRun(root), names, deps.isAlive);
    }
    else {
        const port = deps.tiltPort(root);
        const jsonText = port === null ? null : await deps.fetchJson(port);
        if (jsonText === null) {
            const wanted = new Set(options.only ?? names);
            entries = names
                .filter((name) => wanted.has(name))
                .map((name) => ({ name, status: "unhealthy", reason: "not running" }));
        }
        else {
            const health = tiltServiceHealth(jsonText, names, deps.dependsOn(resources), deps.deferred(resources), options.only);
            // The engine puts a stack's services in the Compose project `<project>-<stack>-autogenerated`.
            const projects = new Map(resources.map((resource) => [
                resource.name,
                composeProjectName(root, resource.stack ?? "main"),
            ]));
            entries = await enrichContainerReasons(health.entries, health.probe, health.exited, (service) => deps.containerState(service, projects.get(service) ?? service, options.cwd));
        }
    }
    return withPreferredReasons(entries, options.preferReasons);
}
