// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { byCodeUnit } from "./compare.js";
import { parseTiltResourceFailures, summarizeTiltBuildError } from "./doctor-runtime.js";
import { effectiveRuntimeStatus, isNeverStarted, isTiltResourcePending, } from "./tilt-resource-state.js";
import { onlyEnabledResources } from "./up-readiness.js";
/** The resources Tilt says this one is waiting for. */
function waitingOn(item) {
    return (item.status?.waiting?.on ?? [])
        .filter((ref) => (ref.kind ?? "UIResource") === "UIResource" && ref.name)
        .map((ref) => ref.name);
}
export function transitiveDependencies(name, dependsOn) {
    const seen = new Set();
    const visit = (current) => {
        for (const dep of dependsOn[current] ?? []) {
            if (seen.has(dep))
                continue;
            seen.add(dep);
            visit(dep);
        }
    };
    visit(name);
    return seen;
}
function isPending(item) {
    return isTiltResourcePending(item.status?.updateStatus ?? "", effectiveRuntimeStatus(item.status));
}
/**
 * Shared resources every service needs. When one of them fails, nothing still pending can become ready, so the wait
 * ends at the next poll instead of when the last unrelated image build finishes (#4125). An image build is a Tilt
 * resource of its own with no dependencies, so the dependency graph alone never links it to a failed postgres.
 */
export const SHARED_INFRASTRUCTURE = ["postgres", "traefik", "golden-layers-build"];
export function buildStartupReport(jsonText, dependsOn, deferred = new Set()) {
    const enabledJson = onlyEnabledResources(jsonText);
    const failures = parseTiltResourceFailures(enabledJson, deferred).failures;
    const failed = failures.map((failure) => ({
        name: failure.name,
        message: failure.error
            ? summarizeTiltBuildError(failure.error)
            : `${failure.updateStatus}/${failure.runtimeStatus}`,
    }));
    const failedNames = new Set(failed.map((entry) => entry.name));
    const items = JSON.parse(enabledJson).items ?? [];
    // service.json dependsOn, plus what Tilt reports as waited for (shared infrastructure such as init-networks, which no
    // service.json names).
    const deps = { ...dependsOn };
    for (const item of items) {
        const name = item.metadata?.name;
        if (!name)
            continue;
        const waits = waitingOn(item);
        if (waits.length > 0)
            deps[name] = [...new Set([...(deps[name] ?? []), ...waits])];
    }
    const blocked = [];
    const starting = [];
    const stillBuilding = [];
    for (const item of items) {
        const name = item.metadata?.name ?? "unknown";
        // A resource Flisk registers but never starts waits on nothing, so it is neither blocked nor starting:
        // parseTiltResourceFailures leaves it out of pendingCount, and this report must agree with it.
        if (name === "(Tiltfile)" ||
            failedNames.has(name) ||
            deferred.has(name) ||
            isNeverStarted(item.status))
            continue;
        const because = [
            ...new Set([
                ...[...transitiveDependencies(name, deps)].filter((dep) => failedNames.has(dep)),
                ...SHARED_INFRASTRUCTURE.filter((infra) => failedNames.has(infra)),
            ]),
        ].sort(byCodeUnit);
        if (because.length > 0) {
            blocked.push({ name, because });
        }
        else if (isPending(item)) {
            starting.push(name);
            if (item.status?.updateStatus === "in_progress") {
                stillBuilding.push(name);
            }
        }
    }
    return {
        failed,
        blocked,
        starting,
        stillBuilding: stillBuilding.length > 0 ? stillBuilding : undefined,
    };
}
/** A failure exists and everything still pending is blocked by it, so waiting longer cannot help. */
export function isStartupStalled(jsonText, dependsOn, deferred = new Set()) {
    const report = buildStartupReport(jsonText, dependsOn, deferred);
    return report.failed.length > 0 && report.starting.length === 0;
}
