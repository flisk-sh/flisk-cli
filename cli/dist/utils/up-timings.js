// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
function parseTime(value) {
    if (!value)
        return Number.NaN;
    return Date.parse(value);
}
/** The latest completed update's finish time, or undefined when the resource never finished one. */
function lastFinish(item) {
    const history = item?.status?.buildHistory ?? [];
    for (const entry of [...history].reverse()) {
        const time = parseTime(entry.finishTime);
        if (Number.isFinite(time))
            return { time, at: entry.finishTime };
    }
    return undefined;
}
/**
 * Per-service start-to-ready times read from one `tilt get uiresources -o json` answer. A service's own update ends
 * when its container runs, so `readyAt` extends to its `-healthy` or `-done` gate when Tilt registers one
 * (apply_compose_resource_registration.star): that finish is the moment a dependent may actually use the service.
 * Every named service gets an entry; a service Tilt never deployed keeps only its name.
 */
export function serviceTimings(jsonText, serviceNames) {
    const byName = new Map();
    try {
        const parsed = JSON.parse(jsonText);
        for (const item of parsed.items ?? []) {
            const name = item.metadata?.name;
            if (name)
                byName.set(name, item);
        }
    }
    catch {
        return [];
    }
    return serviceNames.map((service) => {
        const history = byName.get(service)?.status?.buildHistory ?? [];
        const update = [...history]
            .reverse()
            .find((entry) => Number.isFinite(parseTime(entry.startTime)));
        if (!update?.startTime)
            return { service };
        const startedTime = parseTime(update.startTime);
        // Anything finished before this update started is a stale entry from a previous run, not this container.
        const finish = lastFinish(byName.get(service));
        const candidates = finish && finish.time >= startedTime ? [finish] : [];
        for (const gate of [`${service}-healthy`, `${service}-done`]) {
            const gateFinish = lastFinish(byName.get(gate));
            if (gateFinish && gateFinish.time >= startedTime)
                candidates.push(gateFinish);
        }
        const latest = candidates.reduce((best, entry) => (best === undefined || entry.time > best.time ? entry : best), undefined);
        const readyAt = latest?.at;
        const startToReadyMs = latest !== undefined ? latest.time - startedTime : undefined;
        return {
            service,
            startedAt: update.startTime,
            ...(readyAt !== undefined ? { readyAt } : {}),
            ...(startToReadyMs !== undefined ? { startToReadyMs } : {}),
        };
    });
}
