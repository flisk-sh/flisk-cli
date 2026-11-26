// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  createByoServiceJson,
  describe,
  expect,
  getFrontendFramework,
  it,
  withViteEnvTypes,
} from "./test-support.js";

describe("createByoServiceJson", () => {
  it("creates standard BYO service manifest with Dockerfile and default settings", () => {
    const manifest = createByoServiceJson("cache-service", "infra", 4500, {
      healthCheckPath: "/health",
      dockerfile: "Dockerfile.custom",
    });
    expect(manifest.appName).toBe("cache-service");
    expect(manifest.appType).toBe("bring-your-own");
    expect(manifest.stack).toBe("infra");
    expect(manifest.port).toBe(4500);
    expect(manifest.healthCheckPath).toBe("/health");
    expect((manifest as Record<string, unknown>).dockerfile).toBe("Dockerfile.custom");
    expect(manifest).not.toHaveProperty("image");
    expect(manifest).not.toHaveProperty("exposeViaProxy");
    expect(manifest).not.toHaveProperty("restart");
    expect(manifest.$schema).toMatch(/schema\.service\.json$/);
  });

  it("creates BYO service manifest with image instead of dockerfile", () => {
    const manifest = createByoServiceJson("redis-db", "data", 4501, {
      healthCheckPath: "/ready",
      dockerfile: "",
      image: "redis:7-alpine",
    });
    expect(manifest.appName).toBe("redis-db");
    expect((manifest as Record<string, unknown>).image).toBe("redis:7-alpine");
    expect(manifest).not.toHaveProperty("dockerfile");
    expect(manifest.healthCheckPath).toBe("/ready");
  });

  it("creates BYO service manifest with exposeViaProxy false and custom restart policy", () => {
    const manifest = createByoServiceJson("nats-mq", "infra", 4502, {
      healthCheckPath: "/healthz",
      dockerfile: "Dockerfile",
      exposeViaProxy: false,
      restart: "always",
    });
    expect(manifest.exposeViaProxy).toBe(false);
    expect(manifest.restart).toBe("always");
  });
});

describe("withViteEnvTypes", () => {
  const file = (filename: string) => ({ filename, content: "", description: "", emoji: "" });

  it("adds Vite client types to a Vite frontend that has none", () => {
    const files = withViteEnvTypes([file("src/App.tsx")], getFrontendFramework("react"));
    expect(files.map((f) => f.filename)).toEqual(["src/App.tsx", "src/vite-env.d.ts"]);
    expect(files[1]?.content).toContain('/// <reference types="vite/client" />');
  });

  it("keeps a framework's own vite-env.d.ts and adds nothing to Next.js", () => {
    const own = [file("src/vite-env.d.ts")];
    expect(withViteEnvTypes(own, getFrontendFramework("vue"))).toEqual(own);
    expect(withViteEnvTypes([file("src/app/page.tsx")], getFrontendFramework("next"))).toHaveLength(
      1,
    );
  });
});
