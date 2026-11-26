// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appTypeAndPortErrors,
  generatedFieldErrorsForFile,
  manifestFieldTypos,
  SERVICE_MANIFEST_SCHEMA_URL,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  serviceManifestTypoNotes,
  validateServiceManifest,
} from "../../service-manifest.js";

import { manifestBase } from "./test-support.js";

describe("appTypeAndPortErrors", () => {
  it("reports an unknown appType and a string port together (the file `flisk config verify` used to pass)", () => {
    const result = validateServiceManifest(
      { schemaVersion: 1, appName: "billing-api", appType: "api", stack: "shop", port: "4300" },
      "services/billing-api/service.json",
    );
    expect(result.errors).toEqual([
      'services/billing-api/service.json.appType: unknown type "api"; expected one of backend, frontend, library, sdk, worker, migrator, mcp, agent, database, bring-your-own',
      'services/billing-api/service.json.port: expected an integer from 1 to 65535, got "4300"',
    ]);
  });

  it.each([
    "backend",
    "frontend",
    "library",
    "sdk",
    "worker",
    "migrator",
    "mcp",
    "agent",
    "database",
    "bring-your-own",
  ])("accepts appType %s", (appType) => {
    expect(appTypeAndPortErrors({ ...manifestBase(), appType }, "service.json")).toEqual([]);
  });

  it.each(["api", "infra", "Backend", ""])("rejects appType %j", (appType) => {
    expect(appTypeAndPortErrors({ ...manifestBase(), appType }, "service.json")).toEqual([
      expect.stringMatching(/^service\.json\.appType: unknown type/),
    ]);
  });

  it("leaves a missing or non-string appType to the required and string checks", () => {
    const { appType: _omit, ...withoutType } = manifestBase();
    expect(appTypeAndPortErrors(withoutType, "service.json")).toEqual([]);
    expect(appTypeAndPortErrors({ ...manifestBase(), appType: 3 }, "service.json")).toEqual([]);
    expect(
      validateServiceManifest({ ...manifestBase(), appType: 3 }, "service.json").errors,
    ).toEqual(["service.json.appType: expected a string"]);
  });

  it.each([1, 80, 4300, 5432, 65535])("accepts port %d", (port) => {
    expect(appTypeAndPortErrors({ ...manifestBase(), port }, "service.json")).toEqual([]);
  });

  it("accepts a missing or null port", () => {
    expect(appTypeAndPortErrors(manifestBase(), "service.json")).toEqual([]);
    expect(appTypeAndPortErrors({ ...manifestBase(), port: null }, "service.json")).toEqual([]);
  });

  it.each([
    ["4300", ', got "4300"'],
    [0, ", got 0"],
    [-1, ", got -1"],
    [65536, ", got 65536"],
    [4300.5, ", got 4300.5"],
    [true, ", got true"],
    [[4300], ""],
    [{ port: 4300 }, ""],
  ])("rejects port %j", (port, got) => {
    expect(appTypeAndPortErrors({ ...manifestBase(), port }, "service.json")).toEqual([
      `service.json.port: expected an integer from 1 to 65535${got}`,
    ]);
  });

  it("does not echo a value that holds a line break", () => {
    const errors = appTypeAndPortErrors(
      {
        ...manifestBase(),
        appType: "api\n    privileged: true",
        port: "4000\n    privileged: true",
      },
      "service.json",
    );
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).not.toContain("privileged");
  });

  it("checks command services too", () => {
    const result = validateServiceManifest(
      {
        schemaVersion: 1,
        appName: "api",
        appType: "service",
        command: "node server.js",
        port: "4000",
      },
      "service.json",
    );
    expect(result.errors).toEqual([
      expect.stringMatching(/^service\.json\.appType: unknown type "service"/),
      'service.json.port: expected an integer from 1 to 65535, got "4000"',
    ]);
  });
});

describe("env on a container service", () => {
  it("warns that env is ignored without a command and points to params", () => {
    const result = validateServiceManifest(
      { ...manifestBase(), env: { CATALOG_URL: "http://catalog:4001" } },
      "service.json",
    );
    expect(result.warnings).toEqual([
      expect.stringMatching(/^service\.json\.env: only applies .*"params"/),
    ]);
  });

  it("does not warn for a command service or an empty env", () => {
    const command = validateServiceManifest(
      { ...manifestBase(), command: "node server.js", env: { A: "1" } },
      "service.json",
    );
    expect(command.warnings.filter((w) => w.includes(".env:"))).toEqual([]);
    const empty = validateServiceManifest({ ...manifestBase(), env: {} }, "service.json");
    expect(empty.warnings).toEqual([]);
  });

  it("does not warn for a bring-your-own resource, which reads env", () => {
    const byo = validateServiceManifest(
      { ...manifestBase(), appType: "bring-your-own", image: "example/x:1", env: { A: "1" } },
      "service.json",
    );
    expect(byo.warnings).toEqual([]);
  });
});

describe("service manifest compatibility", () => {
  it("rejects non-object, null, and array manifests", () => {
    expect(validateServiceManifest(null, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest(undefined, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest("raw-string", "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest(12345, "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
    expect(validateServiceManifest([], "service.json")).toEqual({
      errors: ["service.json: expected a JSON object"],
      warnings: [],
    });
  });

  it("requires schema version and reports missing required fields by path", () => {
    const result = validateServiceManifest({}, "services/shop/api/service.json");
    expect(result.errors).toEqual([
      "services/shop/api/service.json.appName: required field is missing",
      "services/shop/api/service.json.appType: required field is missing",
      "services/shop/api/service.json.stack: required field is missing",
      "services/shop/api/service.json.schemaVersion: required field is missing",
    ]);
  });

  it("does not require a stack for an image service, as service-schema.json allows", () => {
    const manifest = {
      schemaVersion: 1,
      appName: "cache",
      appType: "bring-your-own",
      image: "redis:7",
    };
    expect(validateServiceManifest(manifest, "service.json").errors).toEqual([]);
    expect(
      validateServiceManifest({ ...manifest, image: undefined }, "service.json").errors,
    ).toContain("service.json.stack: required field is missing");
    expect(validateServiceManifest({ ...manifest, image: "" }, "service.json").errors).toContain(
      "service.json.stack: required field is missing",
    );
  });

  it("reports required fields that are not strings", () => {
    const result = validateServiceManifest(
      {
        appName: 123,
        appType: null,
        stack: "shop",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      },
      "service.json",
    );
    expect(result.errors).toEqual([
      "service.json.appName: expected a string",
      "service.json.appType: expected a string",
    ]);
  });

  it("warns about extra fields while retaining their values", () => {
    const manifest = {
      appName: "api",
      appType: "backend",
      stack: "shop",
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      customerMetadata: { owner: "team-a" },
    };
    const result = validateServiceManifest(manifest, "service.json");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["service.json.customerMetadata: unknown field is preserved"]);
    expect(result.manifest?.customerMetadata).toEqual({ owner: "team-a" });
  });

  it("suggests the closest known field for typos on unknown service.json fields (#5144)", () => {
    const manifest = {
      appName: "api",
      appType: "backend",
      stack: "shop",
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      portt: 8080,
      dependson: ["web"],
      healthcheckpath: "/healthz",
      featuresenabled: ["metrics"],
      secrts: { required: ["API_KEY"] },
      restrat: "always",
    };
    const result = validateServiceManifest(manifest, "services/shop/api/service.json");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "portt"; did you mean "port"? (ignored by Flisk, kept in the file)',
    );
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "dependson"; did you mean "dependsOn"? (ignored by Flisk, kept in the file)',
    );
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "healthcheckpath"; did you mean "healthCheckPath"? (ignored by Flisk, kept in the file)',
    );
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "featuresenabled"; did you mean "featuresEnabled"? (ignored by Flisk, kept in the file)',
    );
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "secrts"; did you mean "secrets"? (ignored by Flisk, kept in the file)',
    );
    expect(result.warnings).toContain(
      'services/shop/api/service.json: unknown field "restrat"; did you mean "restart"? (ignored by Flisk, kept in the file)',
    );
  });

  it("finds the near-miss keys of one manifest and none in a clean one", () => {
    expect(
      manifestFieldTypos({ ...manifestBase(), comand: "npm run dev", customerMetadata: {} }),
    ).toEqual([{ field: "comand", suggestion: "command" }]);
    expect(manifestFieldTypos(manifestBase())).toEqual([]);
    // A deprecated field is reported as deprecated, never as a typo.
    expect(manifestFieldTypos({ dependencies: ["db"] })).toEqual([]);
  });

  it("names each near-miss key of the discovered services for an error it may have caused", () => {
    const notes = serviceManifestTypoNotes([
      {
        name: "api",
        path: "/p/api",
        configPath: "/p/api/service.json",
        config: { appName: "api", appType: "backend", comand: "npm run dev" },
      },
      {
        name: "web",
        path: "/p/web",
        configPath: "/p/web/service.json",
        config: { appName: "web", appType: "backend", command: "npm run dev" },
      },
      { name: "configless", path: "/p/x", configPath: "/p/x/service.json" },
    ]);
    expect(notes).toEqual([
      'api\'s service.json has "comand"; did you mean "command"? Flisk ignores the misspelled key.',
    ]);
  });

  it("accepts all known service manifest fields without unknown warnings", () => {
    const allKnown = {
      $schema: SERVICE_MANIFEST_SCHEMA_URL,
      agent: { model: "default" },
      apiBasePath: "/api/v1",
      apiPath: "/api",
      appName: "full-service",
      appType: "backend",
      backendName: "flisk-core",
      basePath: "/base",
      build: { context: "." },
      buildContext: "./build",
      databaseName: "shop_db",
      dependencies: ["dep-svc"],
      dev: { liveReload: false },
      dependsOn: ["dep-svc"],
      dockerfile: "Dockerfile",
      enabled: true,
      exposeViaProxy: true,
      featuresEnabled: ["tracing"],
      framework: "fastapi",
      healthCheckPath: "/health",
      language: "python",
      name: "full-service",
      nats: { queueGroup: "q_group" },
      params: { ENV_VAR: "1" },
      playwright: { timeout: 5000 },
      port: 8080,
      replicas: 1,
      restart: "always",
      runtime: "docker",
      sablier: { sessionDuration: "5m" },
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      secrets: { required: ["DB_PASSWORD"] },
      smoke: { via: "proxy", steps: [{ path: "/health", expect: 200 }] },
      stack: "shop",
      syncs: [{ host: "./src", container: "/app" }],
      traefik: { host: "shop.local", pathPrefix: "/api", healthCheck: "/health" },
      type: "service",
    };

    // `image` and `dockerfile` are alternatives (a service runs from one source), so `image` is checked on its own.
    const result = validateServiceManifest(allKnown, "service.json");
    expect(result.errors).toEqual([]);
    const withImage = validateServiceManifest(
      { ...manifestBase(), image: "ghcr.io/org/repo:tag" },
      "service.json",
    );
    expect(withImage.errors).toEqual([]);
    // Only deprecation warnings should be present, no "unknown field" warnings
    const unknownWarnings = [...result.warnings, ...withImage.warnings].filter((w) =>
      w.includes("unknown field"),
    );
    expect(unknownWarnings).toEqual([]);
  });

  it("accepts a smoke block without calling it unknown, and reports a bad one as an error by path", () => {
    const base = manifestBase();
    const good = validateServiceManifest(
      { ...base, smoke: { via: "proxy", steps: [{ path: "/records", expect: 200 }] } },
      "service.json",
    );
    expect(good.errors).toEqual([]);
    expect(good.warnings).toEqual([]);

    const bad = validateServiceManifest(
      { ...base, smoke: { via: "container", steps: [{ path: "records" }] } },
      "service.json",
    );
    expect(bad.errors.join("\n")).toMatch(/service\.json\.smoke\.via/);
    expect(bad.errors.join("\n")).toMatch(/service\.json\.smoke\.steps\[0\]\.path/);
  });

  it("accepts dev.liveReload as a boolean and reports anything else as an error by path", () => {
    const base = manifestBase();
    const ok = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: true } },
      "service.json",
    );
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);

    const bad = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: "yes" } },
      "service.json",
    );
    expect(bad.errors.join("\n")).toMatch(/service\.json\.dev\.liveReload: expected true or false/);

    const badNumber = validateServiceManifest(
      { ...base, language: "go", dev: { liveReload: 1 } },
      "service.json",
    );
    expect(badNumber.errors.join("\n")).toMatch(
      /service\.json\.dev\.liveReload: expected true or false/,
    );
  });

  it("ignores dev when it is null or not an object", () => {
    const base = manifestBase();
    const resultNull = validateServiceManifest({ ...base, dev: null }, "service.json");
    expect(resultNull.errors).toEqual([]);

    const resultString = validateServiceManifest({ ...base, dev: "not-an-object" }, "service.json");
    expect(resultString.errors).toEqual([]);
  });

  it("warns that dev.liveReload only applies to Go services", () => {
    const base = manifestBase();
    const result = validateServiceManifest(
      { ...base, language: "python", dev: { liveReload: true } },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/service\.json\.dev\.liveReload: .*only .*Go/);

    // false does not warn for non-Go services
    const resultFalse = validateServiceManifest(
      { ...base, language: "python", dev: { liveReload: false } },
      "service.json",
    );
    expect(resultFalse.warnings).toEqual([]);

    // A Bun backend reloads by default, so the flag is not ignored there.
    const bun = validateServiceManifest({ ...base, dev: { liveReload: true } }, "service.json");
    expect(bun.warnings).toEqual([]);
  });

  it("warns that dev.liveReload is ignored for Bun app types that have no watcher", () => {
    const base = manifestBase();
    for (const appType of ["backend", "worker", "agent", "mcp"]) {
      const result = validateServiceManifest(
        { ...base, appType, dev: { liveReload: true } },
        "service.json",
      );
      expect(result.warnings.filter((w) => w.includes("dev.liveReload"))).toEqual([]);
    }
    for (const appType of ["bring-your-own", "frontend", "library", "sdk"]) {
      const result = validateServiceManifest(
        { ...base, appType, language: "bun", dev: { liveReload: true } },
        "service.json",
      );
      expect(result.warnings.join("\n")).toMatch(
        /service\.json\.dev\.liveReload: only applies to .*Bun backends.*ignored/,
      );
      // false is a valid opt-out and never warns
      const off = validateServiceManifest(
        { ...base, appType, dev: { liveReload: false } },
        "service.json",
      );
      expect(off.warnings.filter((w) => w.includes("dev.liveReload"))).toEqual([]);
    }
  });

  it("warns specifically that a jwtSecret in service.json is ignored and must not be committed", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        jwtSecret: "committed-by-mistake",
      },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("service.json.jwtSecret");
    expect(result.warnings[0]).toMatch(/ignored/);
    expect(result.warnings[0]).toContain("JWT_SECRET");
    expect(result.warnings[0]).not.toContain("committed-by-mistake");
  });

  it("flags the deprecated dependencies and envVars fields, and says what replaces them", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        dependencies: ["orders"],
        envVars: { LOG_LEVEL: "debug" },
      },
      "service.json",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      "service.json.dependencies: deprecated, use dependsOn (still read for now)",
      "service.json.envVars: deprecated, use params (still read when params is absent)",
    ]);
    expect(result.manifest?.dependencies).toEqual(["orders"]);
    expect(result.manifest?.envVars).toEqual({ LOG_LEVEL: "debug" });
  });

  it("does not flag the current fields", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        dependsOn: ["orders"],
        params: { LOG_LEVEL: "debug" },
      },
      "service.json",
    );
    expect(result.warnings).toEqual([]);
  });

  it("validates route path overrides as strings", () => {
    const base = manifestBase();
    const valid = validateServiceManifest(
      { ...base, apiPath: "/api/v2", basePath: "/web" },
      "services/shop/api/service.json",
    );
    expect(valid.errors).toEqual([]);
    expect(valid.warnings).toEqual([]);

    const invalid = validateServiceManifest(
      { ...base, apiPath: 42, basePath: null },
      "services/shop/api/service.json",
    );
    expect(invalid.errors).toEqual([
      "services/shop/api/service.json.apiPath: expected a string",
      "services/shop/api/service.json.basePath: expected a string",
    ]);
    expect(invalid.warnings).toEqual([]);
  });

  it("rejects unsupported schema versions", () => {
    const result = validateServiceManifest({ ...manifestBase(), schemaVersion: 2 }, "service.json");
    expect(result.errors).toEqual([
      "service.json.schemaVersion: unsupported version 2 (supported: 1)",
    ]);
  });

  it("rejects line breaks and YAML syntax in fields that reach generated output", () => {
    const base = {
      appName: "api",
      appType: "backend",
      stack: "shop",
      schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
      traefik: { pathPrefix: "/api/v1/shop-management" },
    };
    const hostile: Array<Record<string, unknown>> = [
      { healthCheckPath: "/health\n    privileged: true" },
      { healthCheckPath: '/health"' },
      { traefik: { pathPrefix: "/api", host: "a.local\n    privileged: true" } },
      { traefik: { pathPrefix: "/api/v1/x\n    network_mode: host" } },
      { traefik: { pathPrefix: "/api", healthCheck: "/h\n    volumes: []" } },
      { nats: { queueGroup: "g: true" } },
      { databaseName: "Flisk_x\n  privileged: true" },
      { stack: "shop # comment" },
      { image: "app\n    privileged: true" },
      { healthCheckPath: "health" },
      { healthCheckPath: 42 },
    ];
    for (const extra of hostile) {
      const result = validateServiceManifest({ ...base, ...extra }, "service.json");
      expect(result.errors, JSON.stringify(extra)).not.toEqual([]);
    }
  });

  it("names the field in the error and does not echo the unsafe value", () => {
    const result = validateServiceManifest(
      { ...manifestBase(), healthCheckPath: "/health\n    privileged: true" },
      "services/shop/api/service.json",
    );
    expect(result.errors).toEqual([
      "services/shop/api/service.json.healthCheckPath: must be a path such as /health (no spaces, line breaks or YAML syntax)",
    ]);
  });

  it("accepts the values the generator and existing service.json files use", () => {
    const result = validateServiceManifest(
      {
        ...manifestBase(),
        healthCheckPath: "/api/v1/health",
        databaseName: "Flisk_shop",
        image: "ghcr.io/acme/app:1.0@sha256:abc",
        traefik: {
          host: "shop.backend.my-project.local",
          pathPrefix: "/api/v1/shop-management",
          healthCheck: "/health",
        },
        nats: { queueGroup: "shop_backend_svc" },
      },
      "service.json",
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts variable references and fallbacks in healthCheckPath and healthCheck.path while rejecting unsafe syntax", () => {
    const checkoutRef = ["$", "{", "FLISK_CHECKOUT_ID", "}"].join("");
    const fallbackRef = ["$", "{", "FLISK_CHECKOUT_NAME:-local", "}"].join("");

    expect(
      validateServiceManifest(
        { ...manifestBase(), healthCheckPath: `/health/${checkoutRef}` },
        "service.json",
      ).errors,
    ).toEqual([]);
    expect(
      validateServiceManifest(
        { ...manifestBase(), healthCheck: { path: `/health/${fallbackRef}` } },
        "service.json",
      ).errors,
    ).toEqual([]);

    const badVar = ["$", "{", "BAD-VAR", "}"].join("");
    const badDefault = ["$", "{", "FLISK_CHECKOUT_ID:-a b", "}"].join("");
    expect(
      validateServiceManifest(
        { ...manifestBase(), healthCheckPath: `/health/${badVar}` },
        "service.json",
      ).errors,
    ).not.toEqual([]);
    expect(
      validateServiceManifest(
        { ...manifestBase(), healthCheck: { path: `/health/${badDefault}` } },
        "service.json",
      ).errors,
    ).not.toEqual([]);
  });

  it("treats empty generated-output values as unset", () => {
    const result = validateServiceManifest(
      { ...manifestBase(), traefik: { pathPrefix: "/api", healthCheck: "" } },
      "service.json",
    );
    expect(result.errors).toEqual([]);
  });

  it("reports unsafe generated-output values from a file, and nothing for a file it cannot parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "service-manifest-"));
    try {
      const file = join(dir, "service.json");
      writeFileSync(file, JSON.stringify({ ...manifestBase(), stack: "shop\nprivileged: true" }));
      expect(generatedFieldErrorsForFile(file, "service.json")).toEqual([
        "service.json.stack: must be letters, digits, '_' or '-' (no spaces, line breaks or YAML syntax)",
      ]);

      writeFileSync(file, "{ not json");
      expect(generatedFieldErrorsForFile(file, "service.json")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a line break in any string key or value, not only the allowlisted fields", () => {
    const hostile: Array<[Record<string, unknown>, string]> = [
      [{ port: "4000\n    privileged: true" }, "service.json.port"],
      [{ appName: "api\n    privileged: true" }, "service.json.appName"],
      [{ dockerfile: "Dockerfile\n    privileged: true" }, "service.json.dockerfile"],
      [{ buildContext: "src\r    privileged: true" }, "service.json.buildContext"],
      [{ basePath: "/shop privileged: true" }, "service.json.basePath"],
      [
        { envVars: [{ name: "A", value: "v\n    privileged: true" }] },
        "service.json.envVars[0].value",
      ],
      [{ params: { "a\n    privileged": "x" } }, "service.json.params"],
    ];
    for (const [extra, field] of hostile) {
      const { errors } = validateServiceManifest({ ...manifestBase(), ...extra }, "service.json");
      expect(
        errors.some((error) => error.startsWith(`${field}: `)),
        JSON.stringify(extra),
      ).toBe(true);
      expect(errors.join("\n")).not.toContain("privileged");
    }
  });

  it("reports an allowlisted field once and leaves smoke, which never reaches generated config, alone", () => {
    const { errors } = validateServiceManifest(
      {
        ...manifestBase(),
        healthCheckPath: "/health\n    privileged: true",
        smoke: { via: "/api/v1/shop", create: { body: "{\n}" } },
      },
      "service.json",
    );
    expect(errors.filter((error) => error.startsWith("service.json.healthCheckPath"))).toHaveLength(
      1,
    );
    expect(
      errors.filter(
        (error) => error.startsWith("service.json.smoke") && error.includes("line break"),
      ),
    ).toEqual([]);
  });
});
