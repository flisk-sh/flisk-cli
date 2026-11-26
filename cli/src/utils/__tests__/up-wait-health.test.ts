// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../types/index.js";
import type { NativeRunState } from "../native-runtime.js";
import { UNHEALTHY_CONTAINER_MESSAGE } from "../tilt-resource-state.js";
import {
  enrichContainerReasons,
  nativeServiceHealth,
  type ServiceContainerState,
  tiltServiceHealth,
  type UpWaitHealthDeps,
  unhealthyWaitServiceNames,
  upWaitServiceHealth,
} from "../up-wait-health.js";

interface TiltItemSpec {
  name: string;
  updateStatus?: string;
  runtimeStatus?: string;
  healthStatus?: string;
  buildError?: string;
  deployTime?: string | null;
}

/** A `tilt get uiresources -o json` answer for the given resource specs. */
function tiltResources(items: TiltItemSpec[]): string {
  return JSON.stringify({
    items: items.map((item) => ({
      metadata: { name: item.name },
      status: {
        updateStatus: item.updateStatus ?? "ok",
        runtimeStatus: item.runtimeStatus ?? "ok",
        ...(item.healthStatus ? { composeResourceInfo: { healthStatus: item.healthStatus } } : {}),
        ...(item.buildError ? { buildHistory: [{ error: item.buildError }] } : {}),
        lastDeployTime: item.deployTime === undefined ? "2026-06-01T00:00:00Z" : item.deployTime,
        pendingBuildSince: null,
      },
    })),
  });
}

const service = (name: string): DiscoveredResource => ({
  name,
  path: `/proj/services/${name}`,
  configPath: `/proj/services/${name}/service.json`,
});

interface FakeDeps extends Partial<UpWaitHealthDeps> {
  resources?: DiscoveredResource[];
}

/** UpWaitHealthDeps for a project at /proj with the given resources; every probe answered by overrides. */
function fakeDeps(over: FakeDeps = {}): UpWaitHealthDeps {
  const { resources = [service("web"), service("db")], ...deps } = over;
  return {
    projectRoot: () => "/proj",
    discover: () => resources,
    isNative: () => false,
    nativeRun: () => null,
    nativeStates: () => ({}),
    isAlive: () => false,
    dependsOn: () => ({}),
    deferred: () => new Set(),
    tiltPort: () => 10350,
    fetchJson: async () => null,
    containerState: async () => null,
    ...deps,
  };
}

const nativeRun = (services: NativeRunState["services"]): NativeRunState => ({
  pid: 4242,
  startedAt: "2026-06-01T00:00:00Z",
  services,
});

describe("tiltServiceHealth", () => {
  it("marks ready resources healthy and a running health check failure unhealthy", () => {
    const json = tiltResources([{ name: "web" }, { name: "db", healthStatus: "unhealthy" }]);
    const { entries, probe } = tiltServiceHealth(json, ["web", "db"], {}, new Set());
    expect(entries).toEqual([
      { name: "web", status: "healthy" },
      { name: "db", status: "unhealthy", reason: UNHEALTHY_CONTAINER_MESSAGE },
    ]);
    expect(probe.has("db")).toBe(true);
  });

  it("marks a stopped container exited and keeps its reason for the exit code to fill in", () => {
    const json = tiltResources([{ name: "web" }, { name: "worker", runtimeStatus: "error" }]);
    const { entries, exited } = tiltServiceHealth(json, ["web", "worker"], {}, new Set());
    expect(entries).toEqual([
      { name: "web", status: "healthy" },
      { name: "worker", status: "exited" },
    ]);
    expect(exited.has("worker")).toBe(true);
  });

  it("marks a failed build unhealthy, not exited, with the summarized error", () => {
    const json = tiltResources([
      {
        name: "api",
        updateStatus: "error",
        runtimeStatus: "",
        buildError: "ImageBuild: compile exploded",
      },
    ]);
    const { entries, exited } = tiltServiceHealth(json, ["api"], {}, new Set());
    expect(exited.size).toBe(0);
    expect(entries).toEqual([
      { name: "api", status: "unhealthy", reason: "ImageBuild: compile exploded" },
    ]);
  });

  it("gives a service blocked by a failed dependency the dependency as its reason", () => {
    const json = tiltResources([{ name: "db", runtimeStatus: "error" }, { name: "web" }]);
    const { entries } = tiltServiceHealth(json, ["db", "web"], { web: ["db"] }, new Set());
    const web = entries.find((entry) => entry.name === "web");
    // web is blocked through the dependsOn graph: its own container is fine but it cannot be ready.
    expect(web?.status).toBe("unhealthy");
    expect(web?.reason).toBe("db failed");
    expect(web?.blockedBy).toEqual(["db"]);
  });

  it("marks a resource still building as unhealthy and starting", () => {
    const json = tiltResources([{ name: "api", updateStatus: "pending", runtimeStatus: "none" }]);
    const { entries } = tiltServiceHealth(json, ["api"], {}, new Set());
    expect(entries).toEqual([{ name: "api", status: "unhealthy", reason: "starting" }]);
  });

  it("leaves out a deferred resource idling on purpose", () => {
    const json = tiltResources([
      { name: "web" },
      { name: "sleeper", updateStatus: "none", runtimeStatus: "none", deployTime: null },
    ]);
    const { entries } = tiltServiceHealth(json, ["web", "sleeper"], {}, new Set(["sleeper"]));
    expect(entries.map((entry) => entry.name)).toEqual(["web"]);
  });

  it("reports an --only service Tilt never listed as not running", () => {
    const json = tiltResources([{ name: "web" }]);
    const { entries } = tiltServiceHealth(json, ["web", "cli-job"], {}, new Set(), [
      "web",
      "cli-job",
    ]);
    expect(entries).toEqual([
      { name: "web", status: "healthy" },
      { name: "cli-job", status: "unhealthy", reason: "not running" },
    ]);
  });

  it("leaves services with no state and no --only request out of the report", () => {
    const json = tiltResources([{ name: "web" }]);
    const { entries } = tiltServiceHealth(json, ["web", "other"], {}, new Set());
    expect(entries.map((entry) => entry.name)).toEqual(["web"]);
  });
});

describe("nativeServiceHealth", () => {
  const isAlive = (): boolean => true;

  it("marks a ready service healthy and a given-up one exited with its reason", () => {
    const states = {
      web: { status: "ready" as const },
      worker: { status: "error" as const, reason: "exited repeatedly; the supervisor gave up" },
    };
    const run = nativeRun({ web: { pid: 1, ready: true }, worker: { failed: true } });
    expect(nativeServiceHealth(states, run, ["web", "worker"], isAlive)).toEqual([
      { name: "web", status: "healthy" },
      {
        name: "worker",
        status: "exited",
        reason: "exited repeatedly; the supervisor gave up",
      },
    ]);
  });

  it("marks a one-shot job that did not exit 0 as exited", () => {
    const states = {
      migrator: { status: "pending" as const, reason: "the job did not exit 0" },
    };
    const run = nativeRun({ migrator: { pid: 9, job: true } });
    expect(nativeServiceHealth(states, run, ["migrator"], () => false)).toEqual([
      { name: "migrator", status: "exited", reason: "the job did not exit 0" },
    ]);
  });

  it("marks a job that exited 0 healthy", () => {
    const states = {
      migrator: { status: "ready" as const, reason: "finished" },
    };
    const run = nativeRun({ migrator: { job: true, ready: true } });
    expect(nativeServiceHealth(states, run, ["migrator"], isAlive)).toEqual([
      { name: "migrator", status: "healthy" },
    ]);
  });

  it("keeps a service waiting on a dependency unhealthy with who it waits for", () => {
    const states = {
      api: { status: "pending" as const, reason: "waiting for db" },
      db: { status: "ready" as const },
    };
    const run = nativeRun({
      api: { waitingFor: ["db"] },
      db: { pid: 2, ready: true },
    });
    expect(nativeServiceHealth(states, run, ["api", "db"], isAlive)).toEqual([
      { name: "api", status: "unhealthy", reason: "waiting for db", blockedBy: ["db"] },
      { name: "db", status: "healthy" },
    ]);
  });

  it("marks a service with no live run unhealthy and not running", () => {
    const states = {
      web: { status: "unknown" as const, reason: "not running" },
    };
    expect(nativeServiceHealth(states, null, ["web"], isAlive)).toEqual([
      { name: "web", status: "unhealthy", reason: "not running" },
    ]);
  });
});

describe("enrichContainerReasons", () => {
  const inspect =
    (states: Record<string, ServiceContainerState>) =>
    async (name: string): Promise<ServiceContainerState | null> =>
      states[name] ?? null;

  it("appends the container's exit code to an exited service's reason", async () => {
    const entries = [{ name: "worker", status: "exited" as const }];
    const out = await enrichContainerReasons(
      entries,
      new Set(),
      new Set(["worker"]),
      inspect({ worker: { exitCode: 1, probeOutput: null } }),
    );
    expect(out[0]).toEqual({ name: "worker", status: "exited", reason: "exited with code 1" });
  });

  it("attaches the code to a reason the state already gave", async () => {
    const entries = [
      { name: "worker", status: "exited" as const, reason: "ImageBuild: compile exploded" },
    ];
    const out = await enrichContainerReasons(
      entries,
      new Set(),
      new Set(["worker"]),
      inspect({ worker: { exitCode: 137, probeOutput: null } }),
    );
    expect(out[0]?.reason).toBe("ImageBuild: compile exploded (exit code 137)");
  });

  it("replaces the generic health-check message with the last probe line", async () => {
    const entries = [
      { name: "db", status: "unhealthy" as const, reason: UNHEALTHY_CONTAINER_MESSAGE },
    ];
    const out = await enrichContainerReasons(
      entries,
      new Set(["db"]),
      new Set(),
      inspect({ db: { exitCode: null, probeOutput: "pg_isready: no response" } }),
    );
    expect(out[0]?.reason).toBe("health check failing: pg_isready: no response");
  });

  it("keeps a specific reason even when a probe line exists", async () => {
    const entries = [{ name: "db", status: "unhealthy" as const, reason: "OOM killed" }];
    const out = await enrichContainerReasons(
      entries,
      new Set(["db"]),
      new Set(),
      inspect({ db: { exitCode: null, probeOutput: "pg_isready: no response" } }),
    );
    expect(out[0]?.reason).toBe("OOM killed");
  });

  it("inspects at most five containers", async () => {
    const names = Array.from({ length: 7 }, (_, i) => `svc${i}`);
    const entries = names.map((name) => ({ name, status: "exited" as const }));
    const seen: string[] = [];
    const out = await enrichContainerReasons(entries, new Set(), new Set(names), async (name) => {
      seen.push(name);
      return { exitCode: 1, probeOutput: null };
    });
    expect(seen).toHaveLength(5);
    expect(out[5]).toEqual({ name: "svc5", status: "exited" });
    expect(out[4]?.reason).toBe("exited with code 1");
  });
});

describe("upWaitServiceHealth", () => {
  it("reports every Tilt service and applies a better reason the up result carried", async () => {
    const json = tiltResources([
      { name: "web" },
      { name: "db", healthStatus: "unhealthy" },
      { name: "worker", runtimeStatus: "error" },
    ]);
    const container = async (name: string): Promise<ServiceContainerState | null> =>
      name === "worker"
        ? { exitCode: 1, probeOutput: null }
        : name === "db"
          ? { exitCode: null, probeOutput: "pg_isready: no response" }
          : null;
    const entries = await upWaitServiceHealth(
      { cwd: "/proj" },
      fakeDeps({
        fetchJson: async () => json,
        containerState: container,
        resources: [service("web"), service("db"), service("worker")],
      }),
    );
    expect(entries).toEqual([
      { name: "web", status: "healthy" },
      { name: "db", status: "unhealthy", reason: "health check failing: pg_isready: no response" },
      { name: "worker", status: "exited", reason: "exited with code 1" },
    ]);
    expect(unhealthyWaitServiceNames(entries)).toEqual(["db", "worker"]);
  });

  it("prefers the failure message the up result gave over a generic state reason", async () => {
    const json = tiltResources([{ name: "db", healthStatus: "unhealthy" }]);
    const entries = await upWaitServiceHealth(
      { cwd: "/proj", preferReasons: new Map([["db", "OOM killed at 14:02"]]) },
      fakeDeps({ fetchJson: async () => json, resources: [service("db")] }),
    );
    // The container probe gives a still better reason when it has one; with none, the failure's own message wins.
    expect(entries).toEqual([{ name: "db", status: "unhealthy", reason: "OOM killed at 14:02" }]);
  });

  it("lists every service not running when Tilt cannot be read", async () => {
    const entries = await upWaitServiceHealth({ cwd: "/proj" }, fakeDeps({ tiltPort: () => null }));
    expect(entries).toEqual([
      { name: "web", status: "unhealthy", reason: "not running" },
      { name: "db", status: "unhealthy", reason: "not running" },
    ]);
  });

  it("restricts the report to the --only selection when Tilt has nothing", async () => {
    const entries = await upWaitServiceHealth(
      { cwd: "/proj", only: ["web"] },
      fakeDeps({ fetchJson: async () => null }),
    );
    expect(entries).toEqual([{ name: "web", status: "unhealthy", reason: "not running" }]);
  });

  it("reports a local-process run from its own state", async () => {
    const entries = await upWaitServiceHealth(
      { cwd: "/proj" },
      fakeDeps({
        resources: [service("api"), service("db")],
        isNative: () => true,
        nativeRun: () => nativeRun({ api: { waitingFor: ["db"] }, db: { failed: true } }),
        nativeStates: () => ({
          api: { status: "pending", reason: "waiting for db" },
          db: { status: "error", reason: "exited repeatedly; the supervisor gave up" },
        }),
      }),
    );
    expect(entries).toEqual([
      {
        name: "api",
        status: "unhealthy",
        reason: "waiting for db",
        blockedBy: ["db"],
      },
      {
        name: "db",
        status: "exited",
        reason: "exited repeatedly; the supervisor gave up",
      },
    ]);
  });

  it("reports nothing outside a project and nothing when discovery fails", async () => {
    expect(await upWaitServiceHealth({ cwd: "/x" }, fakeDeps({ projectRoot: () => null }))).toEqual(
      [],
    );
    const broken = fakeDeps({
      discover: () => {
        throw new Error("not a project");
      },
    });
    expect(await upWaitServiceHealth({ cwd: "/x" }, broken)).toEqual([]);
  });
});
