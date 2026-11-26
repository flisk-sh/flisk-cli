// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  HEALTH_PATH_PATTERN,
  healthCheckErrors,
  healthCheckPathOf,
  isHealthCheckDisabled,
  parseHealthCheckConfig,
  readinessProbeOf,
} from "../service-manifest-health.js";

const file = "services/main/api/service.json";

describe("healthCheckErrors", () => {
  it("accepts an absent, null or boolean healthCheck", () => {
    expect(healthCheckErrors({}, file)).toEqual([]);
    expect(healthCheckErrors({ healthCheck: null }, file)).toEqual([]);
    expect(healthCheckErrors({ healthCheck: true }, file)).toEqual([]);
    expect(healthCheckErrors({ healthCheck: false }, file)).toEqual([]);
  });

  it("rejects non-boolean non-object healthCheck values", () => {
    for (const healthCheck of ["false", 123, ["/health"]]) {
      expect(healthCheckErrors({ healthCheck }, file)).toEqual([
        `${file}.healthCheck: expected true or false, or an object such as { "enabled": true, "path": "/health" }`,
      ]);
    }
  });

  it("rejects unexpected keys", () => {
    expect(healthCheckErrors({ healthCheck: { bogus: 1 } }, file)).toEqual([
      `${file}.healthCheck: unexpected key "bogus" (expected "enabled", "required", "interval", "timeout", "startPeriod", "retries", "path", "port", "command", or "onFailure")`,
    ]);
  });

  it("rejects a non-boolean enabled", () => {
    expect(healthCheckErrors({ healthCheck: { enabled: "yes" } }, file)).toEqual([
      `${file}.healthCheck.enabled: expected true or false`,
    ]);
  });

  it.each([
    [{ interval: 0 }, "interval"],
    [{ interval: -5 }, "interval"],
    [{ interval: "10s" }, "interval"],
    [{ timeout: 0 }, "timeout"],
    [{ timeout: -5 }, "timeout"],
    [{ timeout: "5s" }, "timeout"],
    [{ startPeriod: 0 }, "startPeriod"],
    [{ startPeriod: -1 }, "startPeriod"],
    [{ startPeriod: "30s" }, "startPeriod"],
    [{ startPeriod: Number.NaN }, "startPeriod"],
  ])("rejects %j", (healthCheck, key) => {
    expect(healthCheckErrors({ healthCheck }, file)).toEqual([
      `${file}.healthCheck.${key}: expected a positive number`,
    ]);
  });

  it("accepts positive fractional timings", () => {
    expect(
      healthCheckErrors(
        { healthCheck: { startPeriod: 30, interval: 5, timeout: 3, retries: 3 } },
        file,
      ),
    ).toEqual([]);
    expect(healthCheckErrors({ healthCheck: { startPeriod: 2.5 } }, file)).toEqual([]);
  });

  it.each([-1, 1.5, "3"])("rejects retries %j", (retries) => {
    expect(healthCheckErrors({ healthCheck: { retries } }, file)).toEqual([
      `${file}.healthCheck.retries: expected a non-negative integer`,
    ]);
  });

  it("accepts retries 0", () => {
    expect(healthCheckErrors({ healthCheck: { retries: 0 } }, file)).toEqual([]);
  });

  it("rejects a non-string or unsafe path", () => {
    expect(healthCheckErrors({ healthCheck: { path: 42 } }, file)).toEqual([
      `${file}.healthCheck.path: expected a string`,
    ]);
    for (const path of ["health", "/health check", '/health"', "/health\n  privileged: true"]) {
      expect(healthCheckErrors({ healthCheck: { path } }, file)).toEqual([
        `${file}.healthCheck.path: must be a path such as /health (no spaces, line breaks or YAML syntax)`,
      ]);
    }
  });

  it("accepts variable references and fallbacks in the path", () => {
    const checkoutRef = ["$", "{", "FLISK_CHECKOUT_ID", "}"].join("");
    const fallbackRef = ["$", "{", "FLISK_CHECKOUT_NAME:-local", "}"].join("");
    expect(healthCheckErrors({ healthCheck: { path: `/health/${checkoutRef}` } }, file)).toEqual(
      [],
    );
    expect(healthCheckErrors({ healthCheck: { path: `/health/${fallbackRef}` } }, file)).toEqual(
      [],
    );
  });

  it.each([0, -1, 65536, 1.5, "8080"])("rejects port %j", (port) => {
    expect(healthCheckErrors({ healthCheck: { port } }, file)).toEqual([
      `${file}.healthCheck.port: expected a port from 1 to 65535`,
    ]);
  });

  it.each([1, 8080, 65535])("accepts port %d", (port) => {
    expect(healthCheckErrors({ healthCheck: { port } }, file)).toEqual([]);
  });

  it("rejects an empty or non-string-list command", () => {
    for (const command of [[], ["probe", ""], ["probe", 1], "grpc_health_probe", 7]) {
      expect(healthCheckErrors({ healthCheck: { command } }, file)).toEqual([
        `${file}.healthCheck.command: expected the program and its arguments, such as ["grpc_health_probe", "-addr=:9090"]`,
      ]);
    }
  });

  it("accepts a command list", () => {
    expect(
      healthCheckErrors({ healthCheck: { command: ["grpc_health_probe", "-addr=:9090"] } }, file),
    ).toEqual([]);
  });

  it("refuses more than one probe kind", () => {
    expect(healthCheckErrors({ healthCheck: { path: "/health", port: 8080 } }, file)).toEqual([
      `${file}.healthCheck: set only one of "path", "port" or "command" (got "path" and "port")`,
    ]);
    expect(healthCheckErrors({ healthCheck: { port: 8080, command: ["probe"] } }, file)).toEqual([
      `${file}.healthCheck: set only one of "path", "port" or "command" (got "port" and "command")`,
    ]);
  });
});

describe("isHealthCheckDisabled", () => {
  it("is disabled only for false or { enabled: false }", () => {
    expect(isHealthCheckDisabled({ healthCheck: false })).toBe(true);
    expect(isHealthCheckDisabled({ healthCheck: { enabled: false } })).toBe(true);
    expect(isHealthCheckDisabled({ healthCheck: true })).toBe(false);
    expect(isHealthCheckDisabled({ healthCheck: { enabled: true } })).toBe(false);
    expect(isHealthCheckDisabled({ healthCheck: { interval: 10 } })).toBe(false);
    expect(isHealthCheckDisabled({})).toBe(false);
    expect(isHealthCheckDisabled(undefined)).toBe(false);
  });
});

describe("readinessProbeOf", () => {
  it("returns the port probe", () => {
    expect(readinessProbeOf({ healthCheck: { port: 9090 } })).toEqual({
      kind: "port",
      port: 9090,
    });
  });

  it("returns the command probe", () => {
    expect(readinessProbeOf({ healthCheck: { command: ["probe", "-x"] } })).toEqual({
      kind: "command",
      command: ["probe", "-x"],
    });
  });

  it("prefers the port probe over command", () => {
    expect(readinessProbeOf({ healthCheck: { port: 9090, command: ["probe"] } })).toEqual({
      kind: "port",
      port: 9090,
    });
  });

  it("is undefined for an HTTP path probe, an absent check and a disabled check", () => {
    expect(readinessProbeOf({ healthCheck: { path: "/health" } })).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: true })).toBeUndefined();
    expect(readinessProbeOf({})).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: false, healthCheckPath: "/h" })).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: { enabled: false, port: 9090 } })).toBeUndefined();
  });

  it("is undefined for malformed probes", () => {
    expect(readinessProbeOf({ healthCheck: { port: 0 } })).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: { port: 65536 } })).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: { command: [] } })).toBeUndefined();
    expect(readinessProbeOf({ healthCheck: { command: ["probe", 1] } })).toBeUndefined();
  });
});

describe("healthCheckPathOf", () => {
  it("prefers healthCheck.path, then healthCheckPath, then the fallback", () => {
    expect(
      healthCheckPathOf({ healthCheck: { path: "/healthz" }, healthCheckPath: "/status" }),
    ).toBe("/healthz");
    expect(healthCheckPathOf({ healthCheckPath: "/status" })).toBe("/status");
    expect(healthCheckPathOf({ healthCheck: true }, "/health")).toBe("/health");
    expect(healthCheckPathOf({}, "/health")).toBe("/health");
    expect(healthCheckPathOf({})).toBeUndefined();
  });

  it("is undefined when a port or command probe replaces the HTTP one", () => {
    expect(
      healthCheckPathOf({ healthCheck: { port: 9090 }, healthCheckPath: "/status" }),
    ).toBeUndefined();
    expect(
      healthCheckPathOf({ healthCheck: { command: ["probe"] }, healthCheckPath: "/status" }),
    ).toBeUndefined();
  });
});

describe("parseHealthCheckConfig", () => {
  it("parses a disabled check as { enabled: false }", () => {
    expect(parseHealthCheckConfig({ healthCheck: false })).toEqual({ enabled: false });
    expect(parseHealthCheckConfig({ healthCheck: { enabled: false } })).toEqual({
      enabled: false,
    });
  });

  it("parses a complete healthCheck object", () => {
    expect(
      parseHealthCheckConfig({
        healthCheck: { enabled: true, interval: 5, timeout: 2, retries: 3, path: "/livez" },
      }),
    ).toEqual({ enabled: true, interval: 5, timeout: 2, retries: 3, path: "/livez" });
  });

  it("inherits healthCheckPath and honors options.defaultPath", () => {
    expect(
      parseHealthCheckConfig({ healthCheck: { timeout: 1 }, healthCheckPath: "/custom" }),
    ).toEqual({ enabled: true, timeout: 1, path: "/custom" });
    expect(parseHealthCheckConfig({}, { defaultPath: "/health" })).toEqual({
      enabled: true,
      path: "/health",
    });
    expect(parseHealthCheckConfig({ healthCheck: true })).toEqual({ enabled: true });
  });

  it("omits the path when a port or command probe replaces it", () => {
    expect(
      parseHealthCheckConfig(
        { healthCheck: { port: 9090 }, healthCheckPath: "/status" },
        { defaultPath: "/health" },
      ),
    ).toEqual({ enabled: true });
  });
});

describe("HEALTH_PATH_PATTERN", () => {
  it("accepts plain paths and variable references, rejects unsafe syntax", () => {
    expect(HEALTH_PATH_PATTERN.test("/health")).toBe(true);
    expect(HEALTH_PATH_PATTERN.test("/api/v1/health-check-2")).toBe(true);
    expect(HEALTH_PATH_PATTERN.test("/h/${FLISK_CHECKOUT_ID}")).toBe(true);
    expect(HEALTH_PATH_PATTERN.test("/h/${FLISK_CHECKOUT_NAME:-local}")).toBe(true);
    expect(HEALTH_PATH_PATTERN.test("health")).toBe(false);
    expect(HEALTH_PATH_PATTERN.test("/health check")).toBe(false);
    expect(HEALTH_PATH_PATTERN.test("/health\nx: y")).toBe(false);
    expect(HEALTH_PATH_PATTERN.test("/h/${BAD-VAR}")).toBe(false);
    expect(HEALTH_PATH_PATTERN.test("/h/${V:-a b}")).toBe(false);
  });
});
