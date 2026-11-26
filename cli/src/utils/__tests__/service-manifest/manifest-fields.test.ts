// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  getInvalidServiceRoutePathFields,
  validateGeneratedStringFields,
  validateServiceManifest,
} from "../../service-manifest.js";

import { manifestBase } from "./test-support.js";

describe("field types the engine reads", () => {
  const base = (): Record<string, unknown> => ({ ...manifestBase() });
  const errorsFor = (extra: Record<string, unknown>): string[] =>
    validateServiceManifest({ ...base(), ...extra }, "s.json").errors;

  it.each([
    [{ traefik: "x" }, "traefik: expected an object"],
    [{ sablier: "on" }, "sablier: expected an object"],
    [{ nats: [] }, "nats: expected an object"],
    [{ params: "x" }, "params: expected an object"],
    [{ build: "Dockerfile" }, "build: expected an object"],
    [{ featuresEnabled: "vitest" }, "featuresEnabled: expected an array of strings"],
    [{ featuresEnabled: [1] }, "featuresEnabled: expected an array of strings"],
    [{ image: 7 }, "image: expected a string"],
    [{ language: "BUN" }, "language: expected a lowercase id"],
    [{ exposeViaProxy: "no" }, "exposeViaProxy: expected true or false"],
    [{ replicas: 1.5 }, "replicas: expected an integer from 1 to 10"],
    [{ replicas: 0 }, "replicas: expected an integer from 1 to 10"],
    [{ replicas: "2" }, "replicas: expected an integer from 1 to 10"],
    [{ replicas: 100000 }, "replicas: expected an integer from 1 to 10"],
    [{ databaseName: "d".repeat(64) }, "databaseName: at most 63"],
    [{ dockerfile: "/etc/passwd" }, "dockerfile: must be a path relative to the service directory"],
    [
      { buildContext: "/opt/src" },
      "buildContext: must be a path relative to the service directory",
    ],
    [{ buildContext: "C:\\src" }, "buildContext: must be a path relative to the service directory"],
    [
      { build: { context: "/" } },
      "build.context: must be a path relative to the service directory",
    ],
    [{ build: { dockerfile: "/x" } }, "build.dockerfile: must be a path relative to"],
    [{ dev: { command: "x", watch: ["/etc/**"] } }, "dev.watch[0]: must be a path relative to"],
    [{ dev: { watch: "src" } }, "dev.watch: expected an array of strings"],
    // Same wording as an empty top-level command (validateNativeServiceFields), #4191.
    [{ dev: { command: "" } }, 's.json: service "api": dev.command must be a non-empty string'],
    [{ dev: { command: "   " } }, 's.json: service "api": dev.command must be a non-empty string'],
    [{ image: "nginx:1", dockerfile: "Dockerfile" }, 'set "image" or "dockerfile", not both'],
  ])("reports %j", (extra, message) => {
    expect(errorsFor(extra).join("\n")).toContain(message);
  });

  it.each([
    {},
    { replicas: 1 },
    { replicas: 10 },
    { traefik: null },
    { build: null },
    { dockerfile: "docker/Dockerfile.dev" },
    { buildContext: "src" },
    // A service.json inside the project may build from a tree outside it; `flisk import` writes exactly this for a Compose app.
    { buildContext: "../../../api" },
    { buildContext: "../../../../l565-ext/outer-src", dockerfile: "Dockerfile" },
    { build: { context: "../../../api", dockerfile: "Dockerfile" } },
    { build: { dockerfile: "Dockerfile", context: "." } },
    { featuresEnabled: [] },
    { dev: { command: "bun run dev" } },
    { dev: { command: null } },
    { restart: "always" },
    { appType: "bring-your-own" },
  ])("accepts %j", (extra) => {
    expect(errorsFor(extra)).toEqual([]);
  });

  it("refuses a frontend framework that is not registered, which would stop the Vite generator", () => {
    for (const framework of ["Next", "no such", "react;rm", "", "../react"]) {
      expect(errorsFor({ appType: "frontend", framework }).join("\n")).toContain(
        "framework: expected one of",
      );
    }
    for (const framework of ["react", "vue", "tanstack-router", "next"]) {
      expect(errorsFor({ appType: "frontend", framework })).toEqual([]);
    }
    // A backend's framework (hono, express, ...) is not in this list and is not checked here.
    expect(errorsFor({ appType: "backend", framework: "hono" })).toEqual([]);
  });

  it("refuses replicas above 1 on a frontend, which Compose is not generated for", () => {
    expect(errorsFor({ appType: "frontend", replicas: 3 }).join("\n")).toContain(
      "a frontend runs as one container",
    );
    expect(errorsFor({ appType: "frontend", replicas: 1 })).toEqual([]);
    expect(errorsFor({ appType: "backend", replicas: 3 })).toEqual([]);
  });

  it("leaves a local-process service alone", () => {
    expect(errorsFor({ command: "node x.js", replicas: 0, traefik: "x" })).toEqual([]);
  });
});

describe("getInvalidServiceRoutePathFields", () => {
  it("returns empty array for non-objects or arrays", () => {
    expect(getInvalidServiceRoutePathFields(null)).toEqual([]);
    expect(getInvalidServiceRoutePathFields(undefined)).toEqual([]);
    expect(getInvalidServiceRoutePathFields([])).toEqual([]);
    expect(getInvalidServiceRoutePathFields("string")).toEqual([]);
    expect(getInvalidServiceRoutePathFields(123)).toEqual([]);
  });

  it("returns empty array when fields are valid strings or absent", () => {
    expect(getInvalidServiceRoutePathFields({})).toEqual([]);
    expect(getInvalidServiceRoutePathFields({ apiPath: "/api" })).toEqual([]);
    expect(getInvalidServiceRoutePathFields({ basePath: "/base" })).toEqual([]);
    expect(getInvalidServiceRoutePathFields({ apiPath: "/api", basePath: "/base" })).toEqual([]);
  });

  it("returns field names when fields are not strings", () => {
    expect(getInvalidServiceRoutePathFields({ apiPath: 42 })).toEqual(["apiPath"]);
    expect(getInvalidServiceRoutePathFields({ basePath: null })).toEqual(["basePath"]);
    expect(getInvalidServiceRoutePathFields({ apiPath: true, basePath: {} })).toEqual([
      "apiPath",
      "basePath",
    ]);
  });
});

describe("validateGeneratedStringFields", () => {
  it("accepts valid generated string fields", () => {
    const manifest = {
      healthCheckPath: "/health/v1-status",
      traefik: {
        host: "shop.backend.my-project.local",
        pathPrefix: "/api/v1/shop-management",
        healthCheck: "/ping",
      },
      nats: { queueGroup: "shop_backend.group-1" },
      databaseName: "shop_db-2",
      stack: "shop-stack_prod",
      image: "ghcr.io/acme/app:1.0@sha256:abc123def",
    };
    expect(validateGeneratedStringFields(manifest, "service.json")).toEqual([]);
  });

  it("treats null, undefined, and empty string as unset", () => {
    const manifest = {
      healthCheckPath: "",
      traefik: { host: null, pathPrefix: undefined, healthCheck: "" },
      nats: { queueGroup: null },
      databaseName: "",
      stack: undefined,
      image: null,
    };
    expect(validateGeneratedStringFields(manifest, "service.json")).toEqual([]);
  });

  it("reports non-string types for generated fields", () => {
    const manifest = {
      healthCheckPath: 123,
      traefik: { host: true, pathPrefix: ["/path"] },
      nats: { queueGroup: {} },
      databaseName: false,
      image: 99,
    };
    const errors = validateGeneratedStringFields(manifest, "service.json");
    expect(errors).toContain("service.json.healthCheckPath: expected a string");
    expect(errors).toContain("service.json.traefik.host: expected a string");
    expect(errors).toContain("service.json.traefik.pathPrefix: expected a string");
    expect(errors).toContain("service.json.nats.queueGroup: expected a string");
    expect(errors).toContain("service.json.databaseName: expected a string");
    expect(errors).toContain("service.json.image: expected a string");
  });

  it("reports specific pattern requirements without echoing dangerous values", () => {
    const invalidFields: Array<[Record<string, unknown>, string, string]> = [
      [{ healthCheckPath: "health" }, "healthCheckPath", "a path such as /health"],
      [
        { traefik: { host: "host:8080" } },
        "traefik.host",
        "a hostname such as shop.backend.myproject.local",
      ],
      [
        { traefik: { pathPrefix: "api/v1" } },
        "traefik.pathPrefix",
        "a path such as /api/v1/shop-management",
      ],
      [{ traefik: { healthCheck: "health" } }, "traefik.healthCheck", "a path such as /health"],
      [
        { nats: { queueGroup: "queue with spaces" } },
        "nats.queueGroup",
        "letters, digits, '_', '.' or '-'",
      ],
      [{ databaseName: "db.dot" }, "databaseName", "letters, digits, '_' or '-'"],
      [{ stack: "stack.with.dots" }, "stack", "letters, digits, '_' or '-'"],
      [{ image: "image with spaces" }, "image", "an image reference such as ghcr.io/acme/app:1.0"],
    ];

    for (const [partial, fieldName, patternHint] of invalidFields) {
      const errors = validateGeneratedStringFields(partial, "service.json");
      expect(
        errors.some((e) => e.startsWith(`service.json.${fieldName}: must be ${patternHint}`)),
        `Failed for field ${fieldName}`,
      ).toBe(true);
    }
  });

  it("detects control characters in nested object keys and array values", () => {
    const manifestWithBadKey = {
      "root\nkey": "value",
      nested: {
        "nested\rkey": "value",
      },
    };
    const keyErrors = validateGeneratedStringFields(manifestWithBadKey, "service.json");
    expect(keyErrors).toContain("service.json: a key contains a line break");
    expect(keyErrors).toContain("service.json.nested: a key contains a line break");

    const manifestWithUnicodeControls = {
      params: {
        del: "val\x7f",
        nel: "val\x85",
        lineSep: "val\u2028",
        parSep: "val\u2029",
        nul: "val\x00",
      },
    };
    const controlErrors = validateGeneratedStringFields(
      manifestWithUnicodeControls,
      "service.json",
    );
    expect(controlErrors.length).toBe(5);
    for (const err of controlErrors) {
      expect(err).toContain("must not contain line breaks or control characters");
    }
  });
});
