// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * One started service's span from its update's start to the moment the stack counted it ready, as `flisk up --json`
 * reports it in `data.timings` (#4129). A benchmark can see a service that took a minute to count as running without
 * reading the Tilt UI by hand.
 */
export interface ServiceTiming {
  service: string;
  /** RFC3339 time the service's own update started (`docker compose up` for a container service). */
  startedAt?: string;
  /**
   * RFC3339 time the stack counted the service ready. A service behind a `-healthy` gate is ready when that gate
   * finished (the container passed its health check), a one-shot job when its `-done` gate saw it exit 0, and anything
   * else when its own update finished.
   */
  readyAt?: string;
  /** `readyAt` minus `startedAt` in milliseconds. */
  startToReadyMs?: number;
}

interface TiltBuildEntry {
  startTime?: string;
  finishTime?: string;
}

interface TiltStatusItem {
  metadata?: { name?: string };
  status?: {
    buildHistory?: TiltBuildEntry[];
  };
}

function parseTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/** The latest completed update's finish time, or undefined when the resource never finished one. */
function lastFinish(item: TiltStatusItem | undefined): { time: number; at: string } | undefined {
  const history = item?.status?.buildHistory ?? [];
  for (const entry of [...history].reverse()) {
    const time = parseTime(entry.finishTime);
    if (Number.isFinite(time)) return { time, at: entry.finishTime as string };
  }
  return undefined;
}

/**
 * Per-service start-to-ready times read from one `tilt get uiresources -o json` answer. A service's own update ends
 * when its container runs, so `readyAt` extends to its `-healthy` or `-done` gate when Tilt registers one
 * (apply_compose_resource_registration.star): that finish is the moment a dependent may actually use the service.
 * Every named service gets an entry; a service Tilt never deployed keeps only its name.
 */
export function serviceTimings(jsonText: string, serviceNames: readonly string[]): ServiceTiming[] {
  const byName = new Map<string, TiltStatusItem>();
  try {
    const parsed = JSON.parse(jsonText) as { items?: TiltStatusItem[] };
    for (const item of parsed.items ?? []) {
      const name = item.metadata?.name;
      if (name) byName.set(name, item);
    }
  } catch {
    return [];
  }
  return serviceNames.map((service) => {
    const history = byName.get(service)?.status?.buildHistory ?? [];
    const update = [...history]
      .reverse()
      .find((entry) => Number.isFinite(parseTime(entry.startTime)));
    if (!update?.startTime) return { service };
    const startedTime = parseTime(update.startTime);
    // Anything finished before this update started is a stale entry from a previous run, not this container.
    const finish = lastFinish(byName.get(service));
    const candidates = finish && finish.time >= startedTime ? [finish] : [];
    for (const gate of [`${service}-healthy`, `${service}-done`]) {
      const gateFinish = lastFinish(byName.get(gate));
      if (gateFinish && gateFinish.time >= startedTime) candidates.push(gateFinish);
    }
    const latest = candidates.reduce<{ time: number; at: string } | undefined>(
      (best, entry) => (best === undefined || entry.time > best.time ? entry : best),
      undefined,
    );
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
