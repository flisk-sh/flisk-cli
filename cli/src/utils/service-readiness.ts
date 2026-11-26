// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { DiscoveredResource, ServiceRuntimeState } from "../types/index.js";
import { healthyDependsOn } from "./dependency-graph.js";
import { isOneShotJob } from "./native-runtime/plan.js";
import { NATIVE_STARTING_REASON } from "./native-runtime.js";
import { isHealthCheckOptional } from "./service-manifest.js";
import { healthCountedResources, unhealthyServiceNames } from "./status-groups.js";
import { UNHEALTHY_CONTAINER_MESSAGE } from "./tilt-resource-state.js";
import type { ReadinessResult } from "./up-readiness.js";

/**
 * True when a state is a failing health check of a process that is up: a Tilt container that runs but is unhealthy, or a local
 * process that runs and has not passed its probe. A stopped or restarting process, a dependency wait and a failed job are not.
 */
export function isLiveHealthFailure(state: ServiceRuntimeState | undefined): boolean {
  if (!state) return false;
  return (
    state.reason === UNHEALTHY_CONTAINER_MESSAGE ||
    (state.status === "pending" && state.reason === NATIVE_STARTING_REASON)
  );
}

/** True for a one-shot job with no port (a migrator, or `"restart": "no"`): ready once it exits 0, so it is never an optional live service. */
function isPortlessJob(resource: Pick<DiscoveredResource, "config">): boolean {
  return isOneShotJob(resource.config) && typeof resource.config?.port !== "number";
}

/**
 * True when a service opted out of blocking readiness (`healthCheck.required: false`) and only runs with a failing health check.
 * A job is excluded: it has no probe to wait for, and `pending` for a job means it has not finished.
 */
export function isNonBlockingOptionalState(
  resource: Pick<DiscoveredResource, "config">,
  state: ServiceRuntimeState | undefined,
): boolean {
  return (
    isHealthCheckOptional(resource.config) && !isPortlessJob(resource) && isLiveHealthFailure(state)
  );
}

/**
 * True when a dependent is `error` only because optional services it starts after (a plain `dependsOn` edge) run with a failing
 * health check, as `flisk up --wait` counts them. A real failure of a dependency, and an explicit `condition: "service_healthy"`
 * edge, keep blocking.
 */
function isBlockedOnlyByOptionalHealth(
  resource: Pick<DiscoveredResource, "config">,
  state: ServiceRuntimeState | undefined,
  byName: ReadonlyMap<string, Pick<DiscoveredResource, "name" | "type" | "config">>,
  states: Record<string, ServiceRuntimeState> | null,
): boolean {
  const blockers = state?.blockedBy;
  if (!blockers || blockers.length === 0) return false;
  const waitsForProbe = new Set(healthyDependsOn(resource.config));
  return blockers.every((name) => {
    const blocker = byName.get(name);
    return (
      blocker !== undefined &&
      !waitsForProbe.has(name) &&
      isNonBlockingOptionalState(blocker, states?.[name])
    );
  });
}

/** A service whose state says a run reaches it: a stopped or unchecked one does not count as running. */
function hasRunState(state: ServiceRuntimeState | undefined): boolean {
  return state?.status === "ready" || state?.status === "pending" || state?.status === "error";
}

/**
 * The services `--strict`, `wait` and other readiness gates fail on: the failing or still starting ones. Null when nothing
 * of the project is running (no state at all, or every service with a process of its own is unknown or stopped), which is also not
 * ready. A project with no services has nothing to wait for. Services with `healthCheck.required: false` whose
 * container/process is running but failing its health check do not fail the gate.
 */
export function strictNotReady(
  resources: readonly Pick<DiscoveredResource, "name" | "type" | "config">[],
  states: Record<string, ServiceRuntimeState> | null,
): string[] | null {
  const counted = healthCountedResources(resources, states);
  if (counted.length === 0) return [];
  if (!counted.some((resource) => hasRunState(states?.[resource.name]))) {
    return null;
  }
  const byName = new Map(resources.map((resource) => [resource.name, resource]));
  const blocking = resources.filter(
    (resource) =>
      !isNonBlockingOptionalState(resource, states?.[resource.name]) &&
      !isBlockedOnlyByOptionalHealth(resource, states?.[resource.name], byName, states),
  );
  return unhealthyServiceNames(blocking, states);
}

/**
 * A local-process run's answer to the readiness question agents read from `status --json`. It deliberately carries no
 * failures: a local run records each service's own state, which `status` and `wait` report per service instead.
 */
export function readinessFromNativeStates(
  states: Record<string, ServiceRuntimeState>,
  optionalHealth: ReadonlySet<string> = new Set(),
): ReadinessResult | null {
  const entries = Object.entries(states);
  const isRunning = entries.some(([, state]) => hasRunState(state));
  if (!isRunning) return null;
  // A service with `healthCheck.required: false` that runs with a failing probe is reported, and does not hold readiness back.
  const optionalFailures = entries
    .filter(([name, state]) => optionalHealth.has(name) && isLiveHealthFailure(state))
    .map(([name, state]) => ({ name, message: state.reason ?? "starting", runtime: true }));
  const blockingPending = entries.filter(
    ([name, state]) =>
      state.status !== "ready" && !(optionalHealth.has(name) && isLiveHealthFailure(state)),
  );
  return {
    ready: blockingPending.length === 0,
    // A service the supervisor gave up on is a failure to read, not a service still starting.
    failures: entries
      .filter(([, state]) => state.status === "error")
      .map(([name, state]) => ({ name, message: state.reason ?? "failed" })),
    ...(optionalFailures.length > 0 ? { optionalFailures } : {}),
    pending: blockingPending.filter(([, state]) => state.status === "pending").length,
    timedOut: false,
    enabled: entries.map(([name]) => name),
  };
}
