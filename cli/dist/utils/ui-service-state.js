// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { dependsOnOf } from "./dependency-graph.js";
import { getDeferredResourceNames } from "./doctor-runtime.js";
import { deriveServiceStates } from "./service-runtime-state.js";
import { deriveStackStatus } from "./stack-status.js";
import { tiltGetUiResources } from "./up-readiness.js";
/**
 * One look at the running Tilt, used by both the service list and the UI header. Empty states mean no Tilt answered,
 * so every service stays unknown; `running` stays true when Tilt answered with something we cannot parse.
 */
export async function fetchTiltSnapshot(services, tiltPort) {
    let text;
    try {
        text = await tiltGetUiResources(tiltPort);
    }
    catch {
        return { states: {}, running: false };
    }
    if (!text)
        return { states: {}, running: false };
    try {
        return {
            states: deriveServiceStates(text, Object.fromEntries(services.map((r) => [r.name, dependsOnOf(r.config)])), getDeferredResourceNames()),
            running: true,
        };
    }
    catch {
        return { states: {}, running: true };
    }
}
/** The service-state half of {@link fetchTiltSnapshot}, kept for callers that only draw resources. */
export async function fetchServiceStates(services, tiltPort) {
    const { states } = await fetchTiltSnapshot(services, tiltPort);
    return states;
}
/** The same states `flisk status` shows, put onto the stack the UI is about to draw. */
export function applyServiceStates(metadata, states) {
    const resources = metadata.resources.map((resource) => {
        const state = states[resource.name];
        if (!state)
            return resource;
        return {
            ...resource,
            status: state.status,
            ...(state.reason ? { statusReason: state.reason } : {}),
        };
    });
    return {
        ...metadata,
        resources,
        overallStatus: deriveStackStatus(resources.map((r) => r.status)),
    };
}
