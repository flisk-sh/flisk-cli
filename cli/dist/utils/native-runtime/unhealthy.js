import { dependsOnOf } from "../dependency-graph.js";
import { healthCheckPathOf, isHealthCheckDisabled, readinessProbeOf } from "../service-manifest.js";
import { unhealthyServiceNames } from "../status-groups.js";
import { localUrl } from "./plan.js";
/**
 * Which of the project's local-process services are not healthy and why, for `flisk logs --unhealthy`
 * (and through it `flisk up --wait`). A service the run never spawned (it waits on dependencies that are not
 * ready) is told apart from one that started and still fails its readiness check: the report names the service
 * actually blocking the start, not the dependent that only looks down because it was never reached (#5109).
 * Services waiting on dependencies sort last, so the blocker a person should fix comes first.
 */
/**
 * Why a pending service's own readiness check has not passed yet, from what its config probes. Null when
 * nothing more specific than "still starting" can be said (a service with no readiness signal is ready once
 * it stays alive a moment).
 */
function pendingReason(config, port) {
    if (isHealthCheckDisabled(config))
        return undefined;
    const probe = readinessProbeOf(config);
    if (probe?.kind === "port")
        return `nothing listening on port ${probe.port}`;
    if (probe?.kind === "command") {
        return `healthCheck.command has not exited 0: ${probe.command.join(" ")}`;
    }
    if (port === undefined)
        return undefined;
    const path = healthCheckPathOf(config);
    return path === undefined
        ? `nothing listening on port ${port}`
        : `health check ${localUrl(port, path)} did not answer`;
}
/**
 * The unhealthy services, blockers before waiting dependents, each with its reason. `didStart` is false only
 * when the run on record never gave the service a process (no pid was ever written for it), which is how a
 * dependent waiting on an unready dependency is told apart from a service that is itself failing to become
 * ready.
 */
export function nativeUnhealthyServices(resources, states, run) {
    const byName = new Map(resources.map((resource) => [resource.name, resource]));
    const entries = unhealthyServiceNames(resources, states).map((name) => {
        const state = states[name];
        const record = run?.services[name];
        const config = byName.get(name)?.config;
        const didStart = record === undefined ? undefined : record.pid !== undefined;
        const blocked = (record?.waitingFor?.length ?? 0) > 0 || (didStart === false && state?.status !== "error");
        let reason = state?.reason;
        if (didStart === false && state?.status !== "error") {
            const waitingFor = record?.waitingFor?.length
                ? record.waitingFor
                : dependsOnOf(config).filter((dep) => states[dep]?.status !== "ready");
            reason = waitingFor.length > 0 ? `waiting for ${waitingFor.join(", ")}` : "waiting to start";
        }
        else if (state?.status === "pending" && state.reason === "starting") {
            reason = pendingReason(config, record?.port ?? config?.port) ?? reason;
        }
        const entry = {
            name,
            status: state?.status === "error" ? "error" : "pending",
            ...(reason ? { reason } : {}),
            ...(didStart === undefined ? {} : { didStart }),
        };
        return { entry, blocked };
    });
    return entries.sort((a, b) => Number(a.blocked) - Number(b.blocked)).map(({ entry }) => entry);
}
