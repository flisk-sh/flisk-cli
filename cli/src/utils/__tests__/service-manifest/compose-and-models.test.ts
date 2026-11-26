// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  buildArgsErrors,
  byoEnvErrors,
  containerErrors,
  dependsOnErrors,
  loggingErrors,
  modelsErrors,
  providersErrors,
  providersOf,
  restartErrors,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  validateGeneratedStringFields,
  validateServiceManifest,
  volumesErrors,
  webUiErrors,
} from "../../service-manifest.js";

describe("Compose settings from imported stacks, round 3", () => {
  const file = "services/shop/web/service.json";
  const byo = (fields: Record<string, unknown>) => ({
    appName: "web",
    appType: "bring-your-own",
    stack: "shop",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
    dockerfile: "Dockerfile",
    ...fields,
  });

  it("accepts every new shape in one manifest, with no warnings", () => {
    const result = validateServiceManifest(
      byo({
        dependsOn: [
          "cache",
          { name: "db", condition: "service_healthy" },
          { name: "migrate", condition: "service_completed_successfully" },
          { name: "queue", condition: "service_started" },
          { name: "search" },
        ],
        buildArgs: { NODE_VERSION: "${NODE_VERSION:-22}", APP_ENV: "production", TAG: "${TAG-1}" },
        logging: { driver: "json-file", options: { "max-size": "5m", "max-file": "5" } },
        env: {
          CONFIG: "${A:-${B:-file}}",
          MONGO_URL: "mongodb://${U:-x}:${P}@db/eddi?a=b&c=d",
        },
        volumes: [
          { source: "${OM_MCP_SHARED_DIR:-./.mercato/mcp-shared}", target: "/shared" },
          { source: "${OM_CACHE-../cache}", target: "/cache", readOnly: true, selinux: "z" },
          { source: "./data", target: "/data", selinux: "Z" },
        ],
      }),
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    [[{ name: "db", condition: "service_ready" }], "dependsOn[0].condition: expected one of"],
    [[{ name: "db", restart: true }], "dependsOn[0].restart: unknown option"],
    [[{ condition: "service_healthy" }], "dependsOn[0].name: expected a service or stack name"],
    [[42], "dependsOn[0]: expected a name, or an object"],
    [
      [
        { name: "db", condition: "service_healthy" },
        { name: "db", condition: "service_started" },
      ],
      "dependsOn: 'db' lists conflicting conditions 'service_healthy' and 'service_started'",
    ],
    [
      ["db", { name: "db", condition: "service_healthy" }],
      "dependsOn: 'db' lists conflicting conditions 'service_started' and 'service_healthy'",
    ],
  ])("refuses dependsOn %j", (dependsOn, message) => {
    const errors = dependsOnErrors({ dependsOn }, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("accepts dependsOn with repeated names when conditions match", () => {
    const errors = dependsOnErrors(
      {
        dependsOn: [
          { name: "db", condition: "service_healthy" },
          { name: "db", condition: "service_healthy" },
        ],
      },
      file,
    );
    expect(errors).toHaveLength(0);
  });

  it.each([
    [byo({ buildArgs: ["A=b"] }), "buildArgs: expected an object"],
    [byo({ buildArgs: { "1A": "b" } }), "names must be letters"],
    [
      byo({ buildArgs: { A: "b\nprivileged: true" } }),
      "buildArgs.A: expected a string without line breaks",
    ],
    [byo({ buildArgs: { A: 1 } }), "buildArgs.A: expected a string"],
    [
      byo({ dockerfile: undefined, image: "nginx:alpine", buildArgs: { A: "b" } }),
      "only applies to a resource built from a Dockerfile",
    ],
    [{ appType: "backend", buildArgs: { A: "b" } }, "only applies to bring-your-own"],
  ])("refuses buildArgs in %j", (manifest, message) => {
    const errors = buildArgsErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it.each([
    [byo({ logging: "json-file" }), "logging: expected an object"],
    [byo({ logging: { driver: "json-file", labels: "x" } }), "logging.labels: unknown option"],
    [byo({ logging: { driver: "json file" } }), "logging.driver: expected a driver name"],
    [byo({ logging: { driver: "json-file\n    privileged: true" } }), "logging.driver"],
    [byo({ logging: { options: { "max-size\n  x": "5m" } } }), "logging.options: keys must be"],
    [
      byo({ logging: { options: { "max-size": "5m\nprivileged: true" } } }),
      "logging.options.max-size",
    ],
    [
      byo({ logging: { options: { "max-file": 5 } } }),
      "logging.options.max-file: expected a string",
    ],
    [{ appType: "backend", logging: { driver: "local" } }, "only applies to bring-your-own"],
  ])("refuses logging in %j", (manifest, message) => {
    const errors = loggingErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  const volume = (entry: Record<string, unknown>) => ({
    appType: "bring-your-own",
    volumes: [{ target: "/x", ...entry }],
  });

  it.each([
    [volume({ source: "${A:-/etc}" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A:-data}" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A}/../etc" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A}/./x" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A}x" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A}/x y" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A}/x\nprivileged: true" }), "volumes[0].source: variables must be"],
    [volume({ source: "${1A:-./x}" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A:-./x" }), "volumes[0].source: variables must be"],
    [volume({ source: "${A:-./x\n  privileged: true}" }), "volumes[0].source: variables must be"],
    [
      volume({ source: "./x", selinux: "Zz" }),
      "volumes[0].selinux: expected z (shared) or Z (private)",
    ],
    [volume({ source: "data", selinux: "Z" }), "volumes[0].selinux: only applies to a bind mount"],
  ])("refuses the volume %j", (manifest, message) => {
    const errors = volumesErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it.each([
    "${STORAGE_DIR}",
    "${STORAGE_DIR}/redis",
    "${STORAGE_DIR}/redis/data",
    "${DATA:-./data}/sub",
  ])("accepts the bind source %s, selinux included", (source) => {
    expect(volumesErrors(volume({ source, selinux: "Z" }), file, 3)).toEqual([]);
  });

  it.each([
    "host.docker.internal:${OM_HOST_GATEWAY:-host-gateway}",
    "db:${DB_HOST}",
    "db:${DB_HOST-10.0.0.5}",
  ])("accepts the extra host %s", (host) => {
    expect(
      containerErrors({ appType: "bring-your-own", container: { extraHosts: [host] } }, file),
    ).toEqual([]);
  });

  it.each([
    "db:${DB_HOST:-localhost}",
    'db:${DB_HOST:-"}',
    "db:${1A}",
    "db:${A}x",
    "db:${A:-1.2.3.4\nprivileged: true}",
    "db:${A:-:}",
    "db::",
  ])("refuses the extra host %j", (host) => {
    expect(
      containerErrors({ appType: "bring-your-own", container: { extraHosts: [host] } }, file),
    ).toHaveLength(1);
  });

  it("checks that a variable's default bind path stays inside the project", () => {
    expect(volumesErrors(volume({ source: "${A:-../../../../etc}" }), file, 3)).toEqual([
      `${file}.volumes[0].source: must stay inside the project`,
    ]);
    expect(volumesErrors(volume({ source: "${A:-../../../shared}" }), file, 3)).toEqual([]);
  });

  it.each([
    "dxflrs/garage:${GARAGE_VERSION:?GARAGE_VERSION is not set, see .env.example}",
    "app:${TAG?TAG must be set}",
    "app:${TAG:?}",
  ])("accepts the image %s", (image) => {
    expect(validateGeneratedStringFields({ image }, file)).toEqual([]);
  });

  it.each([
    'a:${B:?x"y}',
    "a:${B:?x\\y}",
    "a:${B:?x{y}",
    "a:${B:?x$y}",
    "a:${B:?x\ny}",
    "a:${B:?x`y}",
    "a:${B:?x\u00e9y}",
  ])("refuses the image %j", (image) => {
    expect(validateGeneratedStringFields({ image }, file)).toHaveLength(1);
  });
});

describe("Compose options for imported stacks", () => {
  const file = "services/mail/worker/service.json";
  const byo = (fields: Record<string, unknown>) => ({
    appName: "worker",
    appType: "bring-your-own",
    stack: "mail",
    schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
    image: "nginx:alpine",
    ...fields,
  });

  it("accepts every option in a valid manifest, with no warnings", () => {
    const result = validateServiceManifest(
      byo({
        image: "postgres:${POSTGRES_VERSION:-18}-alpine",
        restart: "on-failure:5",
        container: {
          stopGracePeriod: "1m30s",
          extraHosts: ["host.docker.internal:host-gateway", "legacy:10.0.0.5", "v6:fd00::1"],
          ulimits: {
            nofile: { soft: 65536, hard: 65536 },
            nproc: 65535,
            memlock: { soft: -1, hard: -1 },
          },
          networkAliases: ["mercure", "mercure.local"],
        },
      }),
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    "ghcr.io/anyproto/any-sync-node:${ANY_SYNC_NODE_VERSION}",
    "postgres:${POSTGRES_VERSION:-18}-alpine",
    "${REGISTRY:-ghcr.io}/acme/app:${TAG:-1.0}",
    "nginx:${NGINX_TAG-alpine}",
    "ghcr.io/acme/app:1.0",
  ])("accepts the image %s", (image) => {
    expect(validateGeneratedStringFields({ image }, file)).toEqual([]);
  });

  it.each([
    "a${B",
    "a${B:-}",
    "a${B-}",
    'a${B-x"}',
    "a${1B}",
    'a${B:-x"}',
    "a${B:-x y}",
    "a$B",
    "a${B}}",
    'x"y',
    "a{b}",
    "a\nprivileged: true",
  ])("refuses the image %j", (image) => {
    const errors = validateGeneratedStringFields({ image }, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(".image");
  });

  it.each(["no", "on-failure", "on-failure:1", "on-failure:100", "unless-stopped", "always"])(
    "accepts restart %s",
    (restart) => {
      expect(restartErrors({ appType: "bring-your-own", restart }, file)).toEqual([]);
    },
  );

  it.each([
    "on-failure:0",
    "on-failure:101",
    "on-failure:05",
    "on-failure:",
    "on-failure:5\nprivileged: true",
    "sometimes",
    5,
  ])("refuses restart %j", (restart) => {
    const errors = restartErrors({ appType: "bring-your-own", restart }, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("restart: expected one of");
  });

  it.each([
    [{ startPeriod: 30 }, []],
    [{ startPeriod: 2.5, interval: 5, timeout: 3, retries: 3 }, []],
  ])("accepts healthCheck %j", (healthCheck, expected) => {
    expect(validateServiceManifest(byo({ healthCheck }), file).errors).toEqual(expected);
  });

  it.each([0, -1, "30s", Number.NaN])("refuses healthCheck.startPeriod %j", (startPeriod) => {
    expect(validateServiceManifest(byo({ healthCheck: { startPeriod } }), file).errors).toEqual([
      `${file}.healthCheck.startPeriod: expected a positive number`,
    ]);
  });

  it("leaves restart on other resource types to the type check", () => {
    expect(restartErrors({ appType: "backend", restart: "on-failure:5" }, file)).toEqual([]);
  });

  const container = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    appType: "bring-your-own",
    container: options,
    ...extra,
  });

  it.each([
    [container({ stopGracePeriod: "30" }), "container.stopGracePeriod: expected a duration"],
    [container({ stopGracePeriod: "1.s" }), "container.stopGracePeriod: expected a duration"],
    [container({ stopGracePeriod: "30s\nprivileged: true" }), "container.stopGracePeriod"],
    [container({ stopGracePeriod: 30 }), "container.stopGracePeriod"],
    [container({ extraHosts: "a:1.2.3.4" }), "container.extraHosts: expected a list"],
    [container({ extraHosts: ["a"] }), "container.extraHosts: expected a list"],
    [container({ extraHosts: ["a:1.2.3.999"] }), "container.extraHosts: expected a list"],
    [container({ extraHosts: ["a b:1.2.3.4"] }), "container.extraHosts: expected a list"],
    [container({ extraHosts: ['a:"x'] }), "container.extraHosts: expected a list"],
    [container({ extraHosts: ["a:1.2.3.4\nprivileged: true"] }), "container.extraHosts"],
    [container({ ulimits: ["nofile"] }), "container.ulimits: expected an object"],
    [container({ ulimits: { bogus: 1 } }), "container.ulimits.bogus: expected one of"],
    [container({ ulimits: { nofile: "1" } }), "container.ulimits.nofile: expected a number"],
    [
      container({ ulimits: { nofile: { soft: 1 } } }),
      "container.ulimits.nofile: expected a number",
    ],
    [container({ ulimits: { nofile: -2 } }), "container.ulimits.nofile: expected a number"],
    [
      container({ ulimits: { nofile: { soft: 2, hard: 1 } } }),
      "container.ulimits.nofile: soft must not be above hard",
    ],
    [container({ networkAliases: "mercure" }), "container.networkAliases: expected a list"],
    [container({ networkAliases: ["-mercure"] }), "container.networkAliases: expected a list"],
    [container({ networkAliases: ["mercure\n  privileged: true"] }), "container.networkAliases"],
    [container({ networkAliases: ["a", "a"] }), "container.networkAliases: lists a name twice"],
    [
      container({ networkAliases: ["mercure"] }, { sidecarOf: "app" }),
      "container.networkAliases: does not apply to a sidecar",
    ],
  ])("reports %j", (manifest, message) => {
    const errors = containerErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });
});

describe("modelsErrors", () => {
  const file = "services/nosia/web/service.json";
  const byo = (models: unknown) => ({ appType: "bring-your-own", models });

  it("accepts model references and Compose variables, and an absent value", () => {
    expect(modelsErrors({ appType: "bring-your-own" }, file)).toEqual([]);
    expect(
      modelsErrors(
        byo([
          { name: "llm", model: "ai/smollm2" },
          { name: "qwen", model: "ai/qwen3:8B-Q4_K_M" },
          { name: "hf.model_1", model: "hf.co/org/name" },
          { name: "var", model: "${LLM_MODEL}" },
          { name: "var-default", model: "${LLM_MODEL:-ai/smollm2}" },
          { name: "var-unset-default", model: "${LLM_MODEL-ai/smollm2}" },
        ]),
        file,
      ),
    ).toEqual([]);
  });

  it.each([
    [byo({ name: "llm", model: "ai/smollm2" }), "models: expected a list"],
    [
      { appType: "backend", models: [{ name: "llm", model: "ai/smollm2" }] },
      "only applies to bring-your-own",
    ],
    [byo(["llm"]), "models[0]: expected an object"],
    [byo([{ name: "llm", model: "ai/smollm2", x: 1 }]), "models[0].x: unknown option"],
    [byo([{ model: "ai/smollm2" }]), "models[0].name: expected a model name"],
    [byo([{ name: "-llm", model: "ai/smollm2" }]), "models[0].name: expected a model name"],
    [byo([{ name: "llm\n  evil:", model: "ai/smollm2" }]), "models[0].name: expected a model name"],
    [
      byo([
        { name: "llm", model: "ai/a" },
        { name: "llm", model: "ai/b" },
      ]),
      "models[1].name: llm is listed twice",
    ],
    [byo([{ name: "llm" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: 7 }]), "models[0].model: expected a model"],
    [
      byo([{ name: "llm", model: "ai/smollm2\n    privileged: true" }]),
      "models[0].model: expected a model",
    ],
    [
      byo([{ name: "llm", model: 'ai/smollm2" privileged: true' }]),
      "models[0].model: expected a model",
    ],
    [byo([{ name: "llm", model: "ai/smollm2\\" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "ai/smollm2 x" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: ": x" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${LLM_MODEL" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${LLM_MODEL:-}" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${LLM_MODEL-}" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${LLM_MODEL-ai/x y}" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${1BAD}" }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: '${LLM_MODEL:-ai/x"}' }]), "models[0].model: expected a model"],
    [byo([{ name: "llm", model: "${A}${B}" }]), "models[0].model: expected a model"],
  ])("reports %j", (manifest, message) => {
    const errors = modelsErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("is part of validateServiceManifest, with no unknown-key warning", () => {
    const result = validateServiceManifest(
      {
        appName: "web",
        appType: "bring-your-own",
        stack: "nosia",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
        image: "ghcr.io/nosia-ai/nosia:latest",
        models: [{ name: "llm", model: "${LLM_MODEL:-ai/smollm2}" }],
      },
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("byoEnvErrors", () => {
  const file = "services/tube/companion/service.json";
  const byo = (env: unknown) => ({ appType: "bring-your-own", image: "example/x:1", env });

  it("accepts plain values and ${VAR} references, and ignores other resource types", () => {
    expect(
      byoEnvErrors(
        byo({ PROXY: "socks5://tubehaus:1080", URL: "${TUBEHAUS_URL:-http://localhost:8081}" }),
        file,
      ),
    ).toEqual([]);
    expect(byoEnvErrors({ appType: "backend", env: { A: 1 } }, file)).toEqual([]);
  });

  it.each([
    [byo(["A=1"]), "env: expected an object"],
    [byo({ "1BAD": "x" }), "env.1BAD: names must be letters"],
    [byo({ A: 1 }), "env.A: expected a string"],
    [byo({ A: "x\nprivileged: true" }), "env.A: must not contain line breaks"],
  ])("reports %j", (manifest, message) => {
    const errors = byoEnvErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("is part of validateServiceManifest for a bring-your-own resource", () => {
    const result = validateServiceManifest(
      {
        appName: "companion",
        appType: "bring-your-own",
        stack: "tube",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
        image: "example/x:1",
        env: { PROXY: "socks5://tubehaus:1080" },
      },
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("providersErrors", () => {
  const file = "services/hqc/research-agent/service.json";
  const agent = (providers: unknown, more: Record<string, unknown> = {}) => ({
    appType: "agent",
    dependsOn: ["quantum-sim"],
    providers,
    ...more,
  });

  it("accepts a remote endpoint with a token and a local fallback, and an absent value", () => {
    expect(providersErrors({ appType: "agent" }, file)).toEqual([]);
    expect(
      providersErrors(
        agent({
          "ibm-quantum": {
            url: "https://quantum.cloud.ibm.com/api",
            tokenSecret: "IBM_QUANTUM_TOKEN",
            fallback: "quantum-sim",
          },
          braket: {
            url: "https://braket.us-east-1.amazonaws.com",
            tokenSecret: "AWS_BRAKET_TOKEN",
          },
          docs: { url: "https://docs.quantum.ibm.com", required: false },
        }),
        file,
      ),
    ).toEqual([]);
  });

  it.each([
    [agent(["ibm"]), "providers: expected an object"],
    [
      agent({ ibm: { url: "https://x" } }, { appType: "frontend" }),
      "only applies to container services",
    ],
    [
      agent({ ibm: { url: "https://x" } }, { command: "python main.py" }),
      "only applies to container services",
    ],
    [agent({ IBM: { url: "https://x" } }), "providers.IBM: name it in lowercase"],
    [agent({ ibm: "https://x" }), "providers.ibm: expected an object"],
    [agent({ ibm: { url: "ftp://x" } }), "providers.ibm.url: expected an http(s) URL"],
    [agent({ ibm: { url: "https://x y" } }), "providers.ibm.url: expected an http(s) URL"],
    [
      agent({ ibm: { url: "https://x", tokenSecret: "ibm-token" } }),
      "providers.ibm.tokenSecret: expected",
    ],
    [
      agent({ ibm: { url: "https://x", fallback: "other-sim" } }),
      "list other-sim in dependsOn too",
    ],
    [
      agent({ ibm: { url: "https://x", fallback: "Sim" } }),
      "providers.ibm.fallback: expected a resource name",
    ],
    [
      agent({ ibm: { url: "https://x", required: true } }),
      "providers.ibm.required: needs a tokenSecret",
    ],
    [
      agent({ ibm: { url: "https://x", required: "yes" } }),
      "providers.ibm.required: expected true or false",
    ],
    [agent({ ibm: { url: "https://x", proxy: true } }), "providers.ibm.proxy: unknown option"],
  ])("refuses %j", (manifest, message) => {
    const errors = providersErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("resolves required: a token is required unless there is a fallback", () => {
    expect(
      providersOf(
        agent({
          a: { url: "https://a", tokenSecret: "A_TOKEN" },
          b: { url: "https://b", tokenSecret: "B_TOKEN", fallback: "quantum-sim" },
          c: { url: "https://c", tokenSecret: "C_TOKEN", fallback: "quantum-sim", required: true },
          d: { url: "https://d" },
        }),
      ).map(({ id, required }) => [id, required]),
    ).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
      ["d", false],
    ]);
  });
});

describe("webUiErrors", () => {
  it("accepts webUi on a bring-your-own resource, set or unset", () => {
    expect(webUiErrors({ appType: "bring-your-own", webUi: true }, "svc")).toEqual([]);
    expect(webUiErrors({ appType: "bring-your-own" }, "svc")).toEqual([]);
  });

  it("refuses webUi on another resource type and on a sidecar", () => {
    expect(webUiErrors({ appType: "backend", webUi: true }, "svc")).toEqual([
      'svc.webUi: only applies to bring-your-own resources (appType "bring-your-own")',
    ]);
    expect(
      webUiErrors({ appType: "bring-your-own", webUi: true, sidecarOf: "host" }, "svc"),
    ).toHaveLength(1);
  });
});
