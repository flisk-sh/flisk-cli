// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { serviceTimings } from "../up-timings.js";

interface Build {
  startTime?: string;
  finishTime?: string;
}

const item = (name: string, buildHistory: Build[]) => ({
  metadata: { name },
  status: { buildHistory },
});
const json = (...items: unknown[]) => JSON.stringify({ items });
const build = (startTime: string, finishTime?: string): Build =>
  finishTime === undefined ? { startTime } : { startTime, finishTime };

describe("serviceTimings", () => {
  it("returns an empty list when the Tilt answer is not JSON", () => {
    expect(serviceTimings("not json", ["menu-api"])).toEqual([]);
  });

  it("keeps an entry for every named service, even one Tilt never deployed", () => {
    expect(serviceTimings(json(), ["menu-api", "floor-app"])).toEqual([
      { service: "menu-api" },
      { service: "floor-app" },
    ]);
  });

  it("reports a service's own update span as its start-to-ready time", () => {
    const text = json(item("menu-api", [build("2026-11-13T18:28:52Z", "2026-11-13T18:29:48Z")]));
    expect(serviceTimings(text, ["menu-api"])).toEqual([
      {
        service: "menu-api",
        startedAt: "2026-11-13T18:28:52Z",
        readyAt: "2026-11-13T18:29:48Z",
        startToReadyMs: 56_000,
      },
    ]);
  });

  it("extends readiness to the -healthy gate, the moment dependents may use the service", () => {
    const text = json(
      item("menu-api", [build("2026-11-13T18:28:52Z", "2026-11-13T18:29:48Z")]),
      item("menu-api-healthy", [build("2026-11-13T18:29:49Z", "2026-11-13T18:29:55Z")]),
    );
    expect(serviceTimings(text, ["menu-api"])).toEqual([
      {
        service: "menu-api",
        startedAt: "2026-11-13T18:28:52Z",
        readyAt: "2026-11-13T18:29:55Z",
        startToReadyMs: 63_000,
      },
    ]);
  });

  it("extends a one-shot job's readiness to its -done gate", () => {
    const text = json(
      item("migrator", [build("2026-11-13T18:28:15Z", "2026-11-13T18:28:29Z")]),
      item("migrator-done", [build("2026-11-13T18:28:28Z", "2026-11-13T18:28:52Z")]),
    );
    expect(serviceTimings(text, ["migrator"])).toEqual([
      {
        service: "migrator",
        startedAt: "2026-11-13T18:28:15Z",
        readyAt: "2026-11-13T18:28:52Z",
        startToReadyMs: 37_000,
      },
    ]);
  });

  it("does not extend readiness to a gate that finished before this update started", () => {
    const text = json(
      item("menu-api", [build("2026-11-13T18:28:52Z", "2026-11-13T18:29:48Z")]),
      item("menu-api-healthy", [build("2026-11-13T18:20:00Z", "2026-11-13T18:20:05Z")]),
    );
    expect(serviceTimings(text, ["menu-api"])).toEqual([
      {
        service: "menu-api",
        startedAt: "2026-11-13T18:28:52Z",
        readyAt: "2026-11-13T18:29:48Z",
        startToReadyMs: 56_000,
      },
    ]);
  });

  it("times the latest update when a service was deployed more than once", () => {
    const text = json(
      item("menu-api", [
        build("2026-11-13T18:00:00Z", "2026-11-13T18:01:00Z"),
        build("2026-11-13T18:28:52Z", "2026-11-13T18:29:48Z"),
      ]),
    );
    expect(serviceTimings(text, ["menu-api"])).toEqual([
      {
        service: "menu-api",
        startedAt: "2026-11-13T18:28:52Z",
        readyAt: "2026-11-13T18:29:48Z",
        startToReadyMs: 56_000,
      },
    ]);
  });

  it("keeps startedAt without a readyAt when the update never finished", () => {
    const text = json(item("menu-api", [build("2026-11-13T18:28:52Z")]));
    expect(serviceTimings(text, ["menu-api"])).toEqual([
      { service: "menu-api", startedAt: "2026-11-13T18:28:52Z" },
    ]);
  });

  it("skips resources that are not in the requested service list", () => {
    const text = json(
      item("menu-api", [build("2026-11-13T18:28:52Z", "2026-11-13T18:29:48Z")]),
      item("golden-layers-build", [build("2026-11-13T18:17:00Z", "2026-11-13T18:25:00Z")]),
    );
    const timings = serviceTimings(text, ["menu-api"]);
    expect(timings.map((t) => t.service)).toEqual(["menu-api"]);
  });
});
