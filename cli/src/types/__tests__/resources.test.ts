// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { ResourceConfig, ResourceConfigFields } from "../resources.js";

describe("resource config contract", () => {
  it("accepts the layered fields service.json may declare", () => {
    const config = {
      appName: "api",
      appType: "backend",
      stack: "core",
      schemaVersion: 2,
      port: 4100,
      replicas: 1,
      runtime: "bun",
      featuresEnabled: ["db"],
      dependsOn: ["db"],
      dependencies: ["db"],
      enabled: true,
      basePath: "/api",
      backendName: "api",
      apiPath: "/api",
      healthCheck: { interval: 10, path: "/healthz" },
      healthCheckPath: "/healthz",
      traefik: { host: "api.localhost", pathPrefix: "/api", healthCheck: "/healthz" },
      exposeViaProxy: true,
      webUi: false,
      sablier: { enable: true, group: "demo", sessionDuration: "5m", deferStart: false },
      dockerfile: "Dockerfile",
      image: "ghcr.io/example/api:1",
      container: { command: ["server"], readOnly: true },
      agent: { runtime: "custom", durability: "files" },
      command: "bun run server.ts",
      env: { LOG_LEVEL: "debug" },
      dev: { liveReload: true, watch: ["src"], testOnSave: { enabled: true, path: "src" } },
    } satisfies ResourceConfigFields;
    expect(config.appType).toBe("backend");
    expect(config.dev?.testOnSave).toEqual({ enabled: true, path: "src" });
  });

  it("keeps ResourceConfig open to extra service.json keys", () => {
    const config: ResourceConfig = {
      appName: "api",
      appType: "backend",
      customField: { nested: true },
    };
    expect(config.customField).toEqual({ nested: true });
    expect(config.appName).toBe("api");
  });
});
