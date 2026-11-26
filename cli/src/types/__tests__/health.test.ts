// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { makeResource } from "../../test-support/index.js";
import { parseTiltResourceFailures } from "../../utils/doctor-runtime.js";
import type { checkPrintedUrls } from "../../utils/url-check.js";
import { buildPrintedUrlTargets, printedHealthUrl } from "../../utils/url-check.js";
import type { DiscoveredResource } from "../discovery.js";
import type { ContainerConfig, HealthCheckConfig, HealthCheckObjectConfig } from "../health.js";
import type { ResourceConfigFields } from "../resources.js";

const healthCheck: HealthCheckObjectConfig = {
  enabled: true,
  interval: 10,
  timeout: 5,
  retries: 3,
  startPeriod: 20,
  path: "/healthz",
  command: ["curl", "-f", "http://localhost/healthz"],
};

const container: ContainerConfig = {
  command: ["server", "/data"],
  init: true,
  capAdd: ["SYS_PTRACE"],
  ulimits: { nofile: 1024 },
};

const config = {
  appName: "api",
  appType: "backend",
  port: 4100,
  healthCheck,
  healthCheckPath: "/healthz",
  container,
} satisfies ResourceConfigFields;

describe("health types", () => {
  it("shape the service.json health and container contract a resource carries", () => {
    const resource: DiscoveredResource = makeResource("api", "backend", config);
    const check: HealthCheckConfig | undefined = resource.config?.healthCheck;
    expect(check).toEqual(healthCheck);
    expect(resource.config?.container?.command).toEqual(["server", "/data"]);
    expect(resource.config?.container?.ulimits?.nofile).toBe(1024);
  });

  it("drive the health URL checkStackUrls probes", async () => {
    const { checkStackUrls } = await import("../../commands/up.js");
    const seen: string[] = [];
    const check = (async (targets: readonly { url: string }[]) => {
      seen.push(...targets.map((t) => t.url));
      return targets.map((t) => ({ service: "api", url: t.url, didAnswer: true }));
    }) as unknown as typeof checkPrintedUrls;

    const checks = await checkStackUrls(
      10350,
      [makeResource("api", "backend", config)],
      80,
      new Set(),
      { check },
    );
    expect(checks.every((c) => c.didAnswer)).toBe(true);
    // Flisk's own service types answer /health, whatever service.json's healthCheck.path says.
    expect(seen.filter((url) => url.endsWith("/health"))).toHaveLength(1);
  });

  it("let a routed bring-your-own resource name its own healthCheckPath", () => {
    const byo = makeResource("web", "bring-your-own", {
      appName: "web",
      appType: "bring-your-own",
      port: 3000,
      healthCheckPath: "/readyz",
    } satisfies ResourceConfigFields);
    expect(printedHealthUrl(byo, "http://api.example.localhost/api/web/")).toBe(
      "http://api.example.localhost/api/web/readyz",
    );
    const targets = buildPrintedUrlTargets([byo], 80);
    expect(targets.some((t) => t.url.endsWith("/readyz"))).toBe(true);
  });

  it("surface in parseTiltResourceFailures when Docker marks the health check unhealthy", () => {
    const { failures, okCount } = parseTiltResourceFailures(
      JSON.stringify({
        items: [
          {
            metadata: { name: "db" },
            status: {
              runtimeStatus: "ok",
              updateStatus: "ok",
              composeResourceInfo: { healthStatus: "unhealthy" },
            },
          },
          {
            metadata: { name: "api" },
            status: {
              runtimeStatus: "ok",
              updateStatus: "ok",
              composeResourceInfo: { healthStatus: "healthy" },
            },
          },
        ],
      }),
    );
    expect(okCount).toBe(1);
    expect(failures.map((f) => f.name)).toEqual(["db"]);
    expect(failures[0]?.error).toBe("container is running, but its health check is failing");
  });
});
