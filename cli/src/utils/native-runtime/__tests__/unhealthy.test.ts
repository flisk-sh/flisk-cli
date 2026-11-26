// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { makeResource } from "../../../test-support/index.js";
import type { DiscoveredResource, ServiceRuntimeState } from "../../../types/index.js";
import type { NativeRunState } from "../state.js";
import { nativeUnhealthyServices } from "../unhealthy.js";

const run = (services: NativeRunState["services"]): NativeRunState => ({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  services,
});

const states = (
  entries: Record<string, { status: ServiceRuntimeState["status"]; reason?: string }>,
): Record<string, ServiceRuntimeState> => entries;

describe("nativeUnhealthyServices", () => {
  it("names the failing health check, not just 'starting' (#5109)", () => {
    const resources: DiscoveredResource[] = [
      makeResource("db2", "backend", {
        command: "sleep 300",
        port: 4003,
        healthCheckPath: "/health",
      }),
    ];
    const report = nativeUnhealthyServices(
      resources,
      states({ db2: { status: "pending", reason: "starting" } }),
      run({ db2: { pid: process.pid, port: 4003, ready: false } }),
    );
    expect(report).toEqual([
      {
        name: "db2",
        status: "pending",
        reason: "health check http://localhost:4003/health did not answer",
        didStart: true,
      },
    ]);
  });

  it("says a dependent that was never spawned is not started and what it waits for", () => {
    const resources: DiscoveredResource[] = [
      makeResource("api", "backend", { command: "node api.js", dependsOn: ["db2"] }),
      makeResource("db2", "backend", {
        command: "sleep 300",
        port: 4003,
        healthCheckPath: "/health",
      }),
    ];
    const report = nativeUnhealthyServices(
      resources,
      states({
        api: { status: "pending", reason: "waiting to start" },
        db2: { status: "pending", reason: "starting" },
      }),
      run({
        api: { ready: false },
        db2: { pid: process.pid, port: 4003, ready: false },
      }),
    );
    // The blocker sorts first, whatever order discovery listed the services in.
    expect(report).toEqual([
      {
        name: "db2",
        status: "pending",
        reason: "health check http://localhost:4003/health did not answer",
        didStart: true,
      },
      {
        name: "api",
        status: "pending",
        reason: "waiting for db2",
        didStart: false,
      },
    ]);
  });

  it("keeps the recorded waitingFor of a service that exited while its dependency was down", () => {
    const resources: DiscoveredResource[] = [
      makeResource("worker", "worker", { command: "node w.js", dependsOn: ["db"] }),
      makeResource("db", "backend", { command: "postgres", port: 5432 }),
    ];
    const report = nativeUnhealthyServices(
      resources,
      states({
        worker: { status: "pending", reason: "waiting for db" },
        db: { status: "pending", reason: "starting" },
      }),
      run({
        worker: { pid: 4_000_000_000, ready: false, waitingFor: ["db"] },
        db: { pid: process.pid, port: 5432, ready: false },
      }),
    );
    expect(report.map((entry) => [entry.name, entry.reason, entry.didStart])).toEqual([
      ["db", "nothing listening on port 5432", true],
      ["worker", "waiting for db", true],
    ]);
  });

  it("keeps an error state's own reason and readiness probes of other kinds", () => {
    const resources: DiscoveredResource[] = [
      makeResource("crashed", "backend", { command: "node c.js" }),
      makeResource("probed", "worker", {
        command: "node p.js",
        healthCheck: { port: 9100 },
      }),
      makeResource("silent", "backend", { command: "node s.js", healthCheck: false }),
    ];
    const report = nativeUnhealthyServices(
      resources,
      states({
        crashed: { status: "error", reason: "exited repeatedly; the supervisor gave up" },
        probed: { status: "pending", reason: "starting" },
        silent: { status: "pending", reason: "starting" },
      }),
      run({
        crashed: { failed: true },
        probed: { pid: process.pid, ready: false },
        silent: { pid: process.pid, ready: false },
      }),
    );
    expect(report).toEqual([
      {
        name: "crashed",
        status: "error",
        reason: "exited repeatedly; the supervisor gave up",
        didStart: false,
      },
      {
        name: "probed",
        status: "pending",
        reason: "nothing listening on port 9100",
        didStart: true,
      },
      { name: "silent", status: "pending", reason: "starting", didStart: true },
    ]);
  });
});
