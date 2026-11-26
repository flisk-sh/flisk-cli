// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseTiltResourceFailures } from "../doctor-runtime.js";
import { machineProblemFix, machineProblemFixes } from "../startup-fixes.js";
import { buildStartupReport, isStartupStalled, transitiveDependencies } from "../startup-report.js";
import { formatStartupReport } from "../startup-report-format.js";

function item(name: string, update: string, runtime: string, extra: object = {}) {
  return { metadata: { name }, status: { updateStatus: update, runtimeStatus: runtime, ...extra } };
}
const json = (...items: object[]) => JSON.stringify({ items });
const failedBuild = (message: string) => ({ buildHistory: [{ error: message }] });
const unhealthy = { composeResourceInfo: { healthStatus: "unhealthy" } };

describe("buildStartupReport", () => {
  it("names the failed database and the api that is not ready because of it", () => {
    const report = buildStartupReport(
      json(
        item(
          "postgres",
          "error",
          "none",
          failedBuild("Bind for 0.0.0.0:5432 failed: port is already allocated"),
        ),
        item("api", "pending", "pending"),
        item("frontend", "ok", "ok"),
      ),
      { api: ["postgres"], frontend: ["api"] },
    );
    expect(report.failed).toEqual([
      { name: "postgres", message: "host port 5432 is already allocated" },
    ]);
    // frontend runs, but reaches postgres through api, so it is not ready either (as `flisk status` says).
    expect(report.blocked).toEqual([
      { name: "api", because: ["postgres"] },
      { name: "frontend", because: ["postgres"] },
    ]);
    expect(report.starting).toEqual([]);
  });

  it("blocks services that depend on the failure through another service", () => {
    const report = buildStartupReport(
      json(
        item("postgres", "error", "none"),
        item("api", "pending", "pending"),
        item("web", "pending", "pending"),
      ),
      { api: ["postgres"], web: ["api"] },
    );
    expect(report.blocked).toEqual([
      { name: "api", because: ["postgres"] },
      { name: "web", because: ["postgres"] },
    ]);
  });

  it("does not blame a failure for a service that does not depend on it", () => {
    const report = buildStartupReport(
      json(item("redis", "error", "none"), item("worker", "pending", "pending")),
      { worker: [] },
    );
    expect(report.blocked).toEqual([]);
    expect(report.starting).toEqual(["worker"]);
  });

  it("lists every failed dependency, sorted", () => {
    const report = buildStartupReport(
      json(
        item("redis", "error", "none"),
        item("postgres", "error", "none"),
        item("api", "pending", "pending"),
      ),
      { api: ["redis", "postgres"] },
    );
    expect(report.blocked).toEqual([{ name: "api", because: ["postgres", "redis"] }]);
  });

  it("names an unhealthy database that Tilt calls running, and the running api that depends on it", () => {
    const report = buildStartupReport(
      json(
        item("postgres", "ok", "ok", unhealthy),
        item("api", "ok", "ok"),
        item("worker", "ok", "ok"),
      ),
      { api: ["postgres"] },
    );
    expect(report.failed).toEqual([
      { name: "postgres", message: "container is running, but its health check is failing" },
    ]);
    // Shared postgres is needed by every service, so the worker is blocked too (#4125).
    expect(report.blocked).toEqual([
      { name: "api", because: ["postgres"] },
      { name: "worker", because: ["postgres"] },
    ]);
    expect(report.starting).toEqual([]);
  });

  it("keeps the build error when an update failed on a container that is also unhealthy", () => {
    const report = buildStartupReport(
      json(
        item("postgres", "error", "ok", {
          ...unhealthy,
          ...failedBuild("Bind for 0.0.0.0:5432 failed: port is already allocated"),
        }),
      ),
      {},
    );
    expect(report.failed).toEqual([
      { name: "postgres", message: "host port 5432 is already allocated" },
    ]);
  });

  it("keeps a database whose health check has not passed yet as starting", () => {
    const report = buildStartupReport(
      json(item("postgres", "ok", "ok", { composeResourceInfo: { healthStatus: "starting" } })),
      {},
    );
    expect(report).toEqual({ failed: [], blocked: [], starting: ["postgres"] });
  });

  it("falls back to the raw statuses when Tilt gave no error text", () => {
    const report = buildStartupReport(json(item("postgres", "ok", "error")), {});
    expect(report.failed).toEqual([{ name: "postgres", message: "ok/error" }]);
  });

  it("ignores deferred, disabled and Tiltfile entries", () => {
    const report = buildStartupReport(
      json(
        item("idle", "none", "none"),
        item("other-phase", "none", "none", { disableStatus: { state: "Disabled" } }),
        item("(Tiltfile)", "pending", "none"),
      ),
      {},
      new Set(["idle"]),
    );
    expect(report).toEqual({ failed: [], blocked: [], starting: [] });
  });

  it("counts exactly the resources parseTiltResourceFailures counts as pending", () => {
    const mixed = json(
      item("redis", "error", "none"),
      item("a", "pending", "pending"),
      item("b", "ok", "pending"),
      item("c", "none", "none"),
      item("d", "ok", "ok"),
      item("e", "ok", "not_applicable"),
      item("(Tiltfile)", "pending", "none"),
    );
    const deps = { a: ["redis"] };
    const report = buildStartupReport(mixed, deps);
    const parsed = parseTiltResourceFailures(mixed);
    expect(report.blocked.length + report.starting.length).toBe(parsed.pendingCount);
    expect(report.failed.length).toBe(parsed.failures.length);
  });

  it("reports nothing when Tilt returned no items", () => {
    expect(buildStartupReport("{}", {})).toEqual({ failed: [], blocked: [], starting: [] });
  });

  it("blames a failure for a service that reaches it through a dependency cycle", () => {
    const report = buildStartupReport(
      json(item("postgres", "error", "none"), item("api", "pending", "pending")),
      { api: ["postgres"], postgres: ["api"] },
    );
    expect(report.failed).toEqual([{ name: "postgres", message: "error/none" }]);
    expect(report.blocked).toEqual([{ name: "api", because: ["postgres"] }]);
    expect(report.starting).toEqual([]);
  });

  it("flags a pending resource still in its update as still building", () => {
    const report = buildStartupReport(json(item("api-image", "in_progress", "pending")), {});
    expect(report.starting).toEqual(["api-image"]);
    expect(report.stillBuilding).toEqual(["api-image"]);
  });
});

describe("transitiveDependencies", () => {
  it("visits a dependency shared by two services once", () => {
    const closure = transitiveDependencies("web", {
      web: ["api", "worker"],
      api: ["postgres"],
      worker: ["postgres"],
    });
    expect([...closure].sort()).toEqual(["api", "postgres", "worker"]);
  });

  it("returns every node of a dependency cycle without recursing forever", () => {
    const closure = transitiveDependencies("api", { api: ["postgres"], postgres: ["api"] });
    expect(closure.has("postgres")).toBe(true);
    expect(closure.has("api")).toBe(true);
  });

  it("returns an empty set for a service with no dependencies", () => {
    expect(transitiveDependencies("web", { web: [] }).size).toBe(0);
    expect(transitiveDependencies("web", {}).size).toBe(0);
  });
});

describe("isStartupStalled", () => {
  const deps = { api: ["postgres"], web: ["api"] };

  it("is true when a failure blocks everything still pending", () => {
    const text = json(
      item("postgres", "error", "none"),
      item("api", "pending", "pending"),
      item("web", "pending", "pending"),
    );
    expect(isStartupStalled(text, deps)).toBe(true);
  });

  it("is true when an unhealthy database fails a running api that depends on it", () => {
    const text = json(item("postgres", "ok", "ok", unhealthy), item("api", "ok", "ok"));
    expect(isStartupStalled(text, deps)).toBe(true);
  });

  it("is false while something unrelated to the failure is still starting", () => {
    const text = json(item("api", "error", "none"), item("worker", "pending", "pending"));
    expect(isStartupStalled(text, deps)).toBe(false);
  });

  it("is true as soon as shared postgres fails, though an unrelated image build is still running", () => {
    const text = json(
      item("postgres", "error", "none"),
      item("kitchen-api-image", "error", "none", failedBuild("npm ERR!")),
      item("restaurant-migrator-image", "in_progress", "pending"),
      item("migrator", "pending", "pending"),
    );
    expect(isStartupStalled(text, deps)).toBe(true);
    const report = buildStartupReport(text, deps);
    expect(report.starting).toEqual([]);
    expect(report.blocked.map((b) => b.name)).toContain("restaurant-migrator-image");
  });

  it("is true when traefik or the golden layers build fails", () => {
    for (const shared of ["traefik", "golden-layers-build"]) {
      const text = json(item(shared, "error", "none"), item("web-image", "in_progress", "pending"));
      expect(isStartupStalled(text, {})).toBe(true);
    }
  });

  it("keeps waiting when only one image failed and other services can still start", () => {
    const text = json(
      item("postgres", "ok", "ok"),
      item("kitchen-api-image", "error", "none", failedBuild("npm ERR!")),
      item("menu-api-image", "in_progress", "pending"),
    );
    expect(isStartupStalled(text, {})).toBe(false);
    const report = buildStartupReport(text, {});
    expect(report.failed.map((f) => f.name)).toEqual(["kitchen-api-image"]);
    expect(report.stillBuilding).toEqual(["menu-api-image"]);
  });

  it("is false when nothing has failed", () => {
    expect(isStartupStalled(json(item("api", "pending", "pending")), deps)).toBe(false);
  });
});

describe("shared infrastructure that fails before any service starts", () => {
  // The shape Tilt reports for a resource held back by a failed resource_dep (checked with tilt 0.37: a local_resource
  // whose dependency exits 1 shows waiting.reason "waiting-for-dep" and waiting.on naming it).
  const waitingFor = (name: string) => ({
    waiting: {
      reason: "waiting-for-dep",
      on: [{ apiVersion: "v1alpha1", group: "tilt.dev", kind: "UIResource", name }],
    },
  });
  const poolExhausted =
    "Failed to create Docker network shop_infisical-network: Error response from daemon: all predefined address pools have been fully subnetted";
  const text = json(
    item("init-networks", "error", "not_applicable", failedBuild(poolExhausted)),
    item("postgres", "pending", "pending", waitingFor("init-networks")),
    item("traefik", "pending", "pending", waitingFor("init-networks")),
    item("api", "pending", "pending", waitingFor("postgres")),
  );

  it("counts what Tilt says a resource waits on as a dependency", () => {
    const report = buildStartupReport(text, { api: [] });
    expect(report.starting).toEqual([]);
    expect(report.blocked.map((b) => [b.name, b.because])).toEqual([
      ["postgres", ["init-networks"]],
      ["traefik", ["init-networks"]],
      ["api", ["init-networks"]],
    ]);
  });

  it("ignores waiting-on references that are not UIResources", () => {
    const report = buildStartupReport(
      json(
        item("init-networks", "error", "none"),
        item("postgres", "pending", "pending", {
          waiting: {
            reason: "waiting-for-dep",
            on: [
              {
                apiVersion: "v1alpha1",
                group: "tilt.dev",
                kind: "FileWatch",
                name: "init-networks",
              },
            ],
          },
        }),
      ),
      {},
    );
    expect(report.blocked).toEqual([]);
    expect(report.starting).toEqual(["postgres"]);
  });

  it("leaves stillBuilding unset when nothing is building", () => {
    const report = buildStartupReport(json(item("api", "pending", "pending")), {});
    expect(report.stillBuilding).toBeUndefined();
  });

  it("is stalled, so flisk up stops waiting instead of running into the timeout", () => {
    expect(isStartupStalled(text, { api: [] })).toBe(true);
  });

  it("finds the Docker message in the failed resource's log when Tilt's error is only the exit status", async () => {
    const logs: Record<string, string> = {
      "init-networks": `Initializing Docker networks...\n${poolExhausted}\n`,
    };
    const fixes = await machineProblemFixes(
      [
        { name: "init-networks", message: "Command failed: exit status 1" },
        { name: "api", message: "exit status 1" },
      ],
      async (name) => logs[name] ?? null,
    );
    expect([...fixes.keys()]).toEqual(["init-networks"]);
    const lines = formatStartupReport(
      { failed: [{ name: "init-networks", message: "exit status 1" }], blocked: [], starting: [] },
      false,
      undefined,
      fixes,
    );
    expect(lines.join("\n")).toContain("flisk doctor --fix --scope=machine");
  });

  it("explains an exhausted Docker network pool", () => {
    expect(machineProblemFix(poolExhausted)).toContain("flisk doctor --fix --scope=machine");
    expect(machineProblemFix("exit status 1")).toBeNull();
    const lines = formatStartupReport(buildStartupReport(text, {}), false);
    expect(lines.join("\n")).toContain("Docker has no free network ranges left");
  });
});
