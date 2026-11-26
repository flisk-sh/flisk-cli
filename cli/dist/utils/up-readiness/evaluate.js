// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { parseTiltResourceFailures } from "../doctor-runtime.js";
import { redactProjectText } from "../secret-redaction.js";
import { isHealthCheckDisabled, isHealthCheckOptional } from "../service-manifest.js";
import { discoverResources } from "../services.js";
import { capEnd } from "../startup-logs.js";
import { stripTerminalControls } from "../tilt-events.js";
import { effectiveRuntimeStatus, UNHEALTHY_CONTAINER_MESSAGE } from "../tilt-resource-state.js";
import { findOnPath } from "../which.js";
/**
 * Tilt lists resources outside the current focus (the other release phases, or everything but a `--only` selection) with
 * `disableStatus.state: Disabled` and both statuses `none`, which would read as pending forever. A resource whose update
 * status is `not_applicable` (a serve-only local resource) has nothing to build, so it counts as built.
 * When health checks are disabled for a resource (`disabledHealth`), its container health check status is stripped so
 * running containers are considered ready immediately. The same goes for a container Docker reports unhealthy when
 * `probeCannotRun` says its health command cannot run at all (see `healthProbeCannotRun`), and for a running container
 * whose health check is still `starting` when `healthCheck.required: false` (`optionalHealth`) so an optional sidecar's
 * slow health probe never blocks stack readiness.
 */
export function onlyEnabledResources(jsonText, disabledHealth, probeCannotRun, optionalHealth) {
    const parsed = JSON.parse(jsonText);
    const items = (parsed.items ?? [])
        .filter((item) => item.status?.disableStatus?.state !== "Disabled")
        .map((item) => {
        let current = item;
        if (current.status?.updateStatus === "not_applicable") {
            current = { ...current, status: { ...current.status, updateStatus: "ok" } };
        }
        const name = current.metadata?.name;
        const health = current.status?.composeResourceInfo?.healthStatus;
        if (name &&
            current.status?.composeResourceInfo &&
            ((disabledHealth?.has(name) ?? false) ||
                (health === "unhealthy" && probeCannotRun?.(name) === true) ||
                (health === "starting" && (optionalHealth?.has(name) ?? false)))) {
            const { healthStatus: _healthStatus, ...restInfo } = current.status.composeResourceInfo;
            current = {
                ...current,
                status: {
                    ...current.status,
                    composeResourceInfo: restInfo,
                },
            };
        }
        return current;
    });
    return JSON.stringify({ items });
}
/**
 * The container Docker lists for a Compose service's `com.docker.compose.service` label, or null when there is not
 * exactly one such container or Docker cannot answer. A caller that finds no container means "no information", never
 * "healthy" or "failed".
 */
function inspectServiceContainer(service, exec = execFileSync) {
    try {
        const docker = findOnPath("docker") ?? "docker";
        const options = {
            encoding: "utf-8",
            timeout: 8000,
            stdio: ["ignore", "pipe", "ignore"],
        };
        const ids = exec(docker, ["ps", "-q", "--filter", `label=com.docker.compose.service=${service}`], options)
            .split("\n")
            .filter(Boolean);
        if (ids.length !== 1)
            return null;
        const parsed = JSON.parse(exec(docker, ["inspect", ids[0]], options));
        const first = Array.isArray(parsed) ? parsed[0] : null;
        return typeof first === "object" && first !== null ? first : null;
    }
    catch {
        return null;
    }
}
/**
 * True when a probe's own result shows it never ran the health command: exec form (`test: [CMD, curl, ...]`) is exit -1 with
 * Docker's "OCI runtime exec failed"; shell form is exit 127 with "not found" in the output, or exit 126 with "permission
 * denied" and the like. An exit code alone is not proof (a script that did run can exit 127 too), and a probe that timed out
 * also exits -1, without that output.
 */
function probeNeverRan(probe) {
    const output = probe.Output ?? "";
    if (probe.ExitCode === -1)
        return /OCI runtime exec failed/.test(output);
    if (probe.ExitCode === 127)
        return /not found/i.test(output);
    if (probe.ExitCode === 126) {
        return /permission denied|cannot execute|not executable|is a directory/i.test(output);
    }
    return false;
}
/**
 * True when the container of a Compose service is running and every health probe Docker recorded never ran its command (see
 * `probeNeverRan`), such as `curl` in an image without curl, as in LycheeOrg/Lychee's facial-recognition sidecar. Such a probe
 * says nothing about the app, so it must not fail `flisk up`. Docker keeps only the last five probes: for a shell-form probe
 * the whole failing streak must be inside that log, because an older real failure may have scrolled out of it. A probe that runs
 * and fails is a real failure. More than one container with the service name, or Docker not answering, is "no", never "yes".
 */
export function healthProbeCannotRun(service, options = {}) {
    const state = inspectServiceContainer(service, options.exec)?.State;
    const log = state?.Health?.Log ?? [];
    if (state?.Status !== "running" || log.length === 0 || !log.every(probeNeverRan))
        return false;
    const shellForm = log.some((probe) => probe.ExitCode === 126 || probe.ExitCode === 127);
    return !(shellForm && (state?.Health?.FailingStreak ?? 0) > log.length);
}
/**
 * The health check a Compose service's running container is failing: its `test` argv (without the `CMD`/`CMD-SHELL`
 * marker) and the last entry of `State.Health.Log`, the `exec: "curl": executable file not found` a person otherwise
 * reads out of `docker inspect` by hand. Null when Docker cannot answer, the service has more than one container, the
 * container is not running, or no probe has been recorded yet.
 */
export function healthProbeDetail(service, options = {}) {
    const inspect = inspectServiceContainer(service, options.exec ?? execFileSync);
    const state = inspect?.State;
    const log = state?.Health?.Log ?? [];
    if (state?.Status !== "running" || log.length === 0)
        return null;
    const test = inspect?.Config?.Healthcheck?.Test ?? [];
    const command = test[0] === "CMD" || test[0] === "CMD-SHELL" ? test.slice(1) : test;
    const last = log[log.length - 1] ?? {};
    const redact = options.redact ?? ((text) => redactProjectText(text));
    const output = capEnd(redact(stripTerminalControls(last.Output ?? "")
        .replace(/\s+/g, " ")
        .trim()));
    return { command, output, ...(last.ExitCode !== undefined ? { exitCode: last.ExitCode } : {}) };
}
/** The most failures that get a `docker inspect` each: a stack that fails everywhere must not wait on Docker serially. */
const HEALTH_PROBE_DETAIL_LIMIT = 5;
/**
 * Failures of the "container is running, but its health check is failing" kind (`runtime: true`, or the message itself
 * where the flag did not survive a report rebuild) given their probe's command and last output. Other failures are
 * returned unchanged; a service Docker cannot inspect keeps its failure without a `probe`.
 */
export function withHealthProbeDetails(failures, probeOf = healthProbeDetail) {
    let inspected = 0;
    return failures.map((failure) => {
        if (inspected >= HEALTH_PROBE_DETAIL_LIMIT ||
            (failure.runtime !== true && failure.message !== UNHEALTHY_CONTAINER_MESSAGE))
            return failure;
        inspected += 1;
        const probe = probeOf(failure.name);
        return probe ? { ...failure, probe } : failure;
    });
}
export function getDisabledHealthResourceNames(resources) {
    try {
        const list = resources ?? discoverResources();
        return new Set(list.filter((svc) => isHealthCheckDisabled(svc.config)).map((svc) => svc.name));
    }
    catch {
        return new Set();
    }
}
export function getOptionalHealthResourceNames(resources) {
    try {
        const list = resources ?? discoverResources();
        return new Set(list.filter((svc) => isHealthCheckOptional(svc.config)).map((svc) => svc.name));
    }
    catch {
        return new Set();
    }
}
function enabledNames(jsonText) {
    return (JSON.parse(jsonText).items ?? [])
        .filter((item) => item.status?.disableStatus?.state !== "Disabled")
        .flatMap((item) => (item.metadata?.name ? [item.metadata.name] : []));
}
/**
 * Services the caller asked for must not vanish into the disabled filter: one that Tilt lists as disabled (it can be
 * disabled while running) is a failure, and one Tilt does not list yet is still pending.
 */
export function checkExpectedResources(jsonText, expected) {
    const items = JSON.parse(jsonText).items ?? [];
    const byName = new Map(items.map((item) => [item.metadata?.name, item]));
    return {
        missing: expected.filter((name) => !byName.has(name)),
        disabled: expected.filter((name) => byName.get(name)?.status?.disableStatus?.state === "Disabled"),
    };
}
/** Resources that report on the stack without gating it. */
export function isAdvisoryResource(name) {
    return name.endsWith("-typecheck");
}
/**
 * One look at `tilt get uiresources -o json`. `settled` means polling can stop: everything is ready, or the rest has
 * finished with a failure (an errored resource, or an expected service Tilt has disabled).
 */
export function evaluateTiltReadiness(jsonText, deferred, expected, disabledHealth, probeCannotRun, optionalHealth) {
    const parsed = parseTiltResourceFailures(onlyEnabledResources(jsonText, disabledHealth, probeCannotRun, optionalHealth), deferred);
    // A `<service>-typecheck` resource runs on the host and is advisory: it reports type errors
    // in Tilt, it does not decide whether the stack is up. It must not fail the stack.
    const unhealthyButRunning = unhealthyRunningNames(jsonText);
    const nonAdvisory = parsed.failures.filter((failure) => !isAdvisoryResource(failure.name));
    // Services with `healthCheck.required: false` whose container is running but failing its health check
    // are reported in `optionalFailures` without blocking stack readiness. Build errors and exited containers still block.
    const optionalFailures = [];
    const blocking = [];
    let rebuilding = 0;
    for (const failure of nonAdvisory) {
        if (optionalHealth?.has(failure.name) && unhealthyButRunning.has(failure.name)) {
            // The old container is unhealthy while a new image builds: the stack is not ready until the update finishes.
            if (failure.updateStatus === "in_progress")
                rebuilding += 1;
            optionalFailures.push({
                name: failure.name,
                message: failure.error || `${failure.updateStatus}/${failure.runtimeStatus}`,
                runtime: true,
            });
        }
        else {
            blocking.push(failure);
        }
    }
    let result = {
        ready: blocking.length === 0 &&
            parsed.pendingCount === 0 &&
            rebuilding === 0 &&
            (parsed.okCount > 0 || optionalFailures.length > 0),
        failures: blocking.map((failure) => ({
            name: failure.name,
            message: failure.error || `${failure.updateStatus}/${failure.runtimeStatus}`,
            ...(unhealthyButRunning.has(failure.name) ? { runtime: true } : {}),
            ...(failure.final ? { final: true } : {}),
        })),
        ...(optionalFailures.length > 0 ? { optionalFailures } : {}),
        pending: parsed.pendingCount + rebuilding,
        timedOut: false,
        enabled: enabledNames(jsonText),
    };
    if (expected && expected.length > 0) {
        const { missing, disabled } = checkExpectedResources(jsonText, expected);
        if (missing.length > 0) {
            result = { ...result, ready: false, pending: result.pending + missing.length };
        }
        if (disabled.length > 0) {
            return {
                settled: true,
                result: {
                    ...result,
                    ready: false,
                    failures: [
                        ...result.failures,
                        ...disabled.map((name) => ({ name, message: "disabled in Tilt" })),
                    ],
                },
            };
        }
    }
    return {
        result,
        // A final failure (a host port the runtime refuses to publish) ends the wait the moment it is seen:
        // nothing still pending can make it succeed, so the health window is never waited out (#4216).
        settled: result.ready ||
            (result.failures.length > 0 && result.pending === 0) ||
            blocking.some((failure) => failure.final === true),
    };
}
export function findBuildingResourceNames(jsonText, deferred) {
    try {
        const parsed = JSON.parse(jsonText);
        return (parsed.items ?? [])
            .filter((item) => {
            const name = item.metadata?.name;
            if (!name || name === "(Tiltfile)" || deferred?.has(name) || isAdvisoryResource(name)) {
                return false;
            }
            if (item.status?.disableStatus?.state === "Disabled")
                return false;
            return item.status?.updateStatus === "in_progress";
        })
            .map((item) => item.metadata?.name);
    }
    catch {
        return [];
    }
}
export function findPendingResourceNames(jsonText, deferred) {
    try {
        const parsed = JSON.parse(jsonText);
        return (parsed.items ?? [])
            .filter((item) => {
            const name = item.metadata?.name;
            if (!name || name === "(Tiltfile)" || deferred?.has(name) || isAdvisoryResource(name)) {
                return false;
            }
            if (item.status?.disableStatus?.state === "Disabled")
                return false;
            const update = item.status?.updateStatus ?? "";
            const runtime = effectiveRuntimeStatus(item.status);
            if (update === "error" || runtime === "error")
                return false;
            return update !== "ok" || runtime !== "ok";
        })
            .map((item) => item.metadata?.name);
    }
    catch {
        return [];
    }
}
/**
 * Containers that built and are running but whose health check fails. Unlike an exited container (a migrator that failed,
 * a crash) these can still turn healthy by themselves.
 */
function unhealthyRunningNames(jsonText) {
    try {
        const parsed = JSON.parse(jsonText);
        return new Set((parsed.items ?? [])
            .filter((item) => item.status?.updateStatus !== "error" &&
            // A container that exited keeps its last health status; only a running one can still turn healthy.
            item.status?.runtimeStatus === "ok" &&
            item.status
                ?.composeResourceInfo?.healthStatus === "unhealthy")
            .map((item) => item.metadata?.name));
    }
    catch {
        return new Set();
    }
}
