// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { substitutePublish } from "../../extra-port-publish.js";
import {
  configsErrors,
  containerErrors,
  extraPortsErrors,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  secretConflictWarnings,
  secretsErrors,
  sidecarErrors,
  validateGeneratedStringFields,
  validateServiceManifest,
} from "../../service-manifest.js";

describe("secretConflictWarnings", () => {
  const file = "services/main/api/service.json";

  it("warns when params or env sets a name that secrets also declares", () => {
    const warnings = secretConflictWarnings(
      {
        secrets: { required: ["ADMIN_PASSWORD"], optional: ["TOKEN"] },
        params: { ADMIN_PASSWORD: "changeme", OTHER: "x" },
        env: { TOKEN: "t" },
      },
      file,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("params.ADMIN_PASSWORD");
    expect(warnings[1]).toContain("env.TOKEN");
  });

  it("is quiet when the names differ, or the shapes are not the expected ones", () => {
    expect(
      secretConflictWarnings({ secrets: { required: ["A"] }, params: { B: "1" } }, file),
    ).toEqual([]);
    expect(secretConflictWarnings({ secrets: "A", params: { A: "1" } }, file)).toEqual([]);
    expect(secretConflictWarnings({ secrets: { required: ["A"] }, params: ["A"] }, file)).toEqual(
      [],
    );
    expect(secretConflictWarnings({}, file)).toEqual([]);
  });
});

describe("secretsErrors", () => {
  const file = "services/main/api/service.json";

  it("accepts the documented shape and an absent value", () => {
    expect(secretsErrors({}, file)).toEqual([]);
    expect(secretsErrors({ secrets: null }, file)).toEqual([]);
    expect(secretsErrors({ secrets: { required: ["A_KEY", "_b2"], optional: [] } }, file)).toEqual(
      [],
    );
  });

  it.each([
    [{ secrets: "A_KEY" }, "secrets: expected an object"],
    [{ secrets: ["A_KEY"] }, "secrets: expected an object"],
    [{ secrets: { required: "A_KEY" } }, "secrets.required: expected a list"],
    [{ secrets: { optional: 7 } }, "secrets.optional: expected a list"],
    [{ secrets: { required: ["1BAD"] } }, '"1BAD" is not an environment variable name'],
    [{ secrets: { required: ["A-B"] } }, '"A-B"'],
    [{ secrets: { required: [""] } }, '""'],
    [{ secrets: { required: [7] } }, "7 is not an environment variable name"],
    [{ secrets: { required: ["A${B}"] } }, "is not an environment variable name"],
  ])("rejects %j", (manifest, message) => {
    const errors = secretsErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("accepts file-backed secrets and reports malformed entries", () => {
    expect(
      secretsErrors(
        {
          appType: "bring-your-own",
          secrets: {
            files: [
              {
                name: "wpt_settings",
                source: "./settings.ini",
                target: "/var/www/settings.ini",
                uid: "1000",
                gid: "1000",
                mode: 288,
              },
            ],
          },
        },
        file,
      ),
    ).toEqual([]);

    expect(
      secretsErrors({ appType: "bring-your-own", secrets: { files: "not-an-array" } }, file),
    ).toEqual([`${file}.secrets.files: expected an array of { name, source, target }`]);
    expect(
      secretsErrors(
        {
          appType: "bring-your-own",
          secrets: { files: [{ name: "bad name\n", source: "./s.txt" }] },
        },
        file,
      ),
    ).toContain(
      `${file}.secrets.files[0].name: "bad name\\n" is not a valid secret identifier name (letters, digits, dashes, dots and underscores)`,
    );
    expect(
      secretsErrors(
        { appType: "bring-your-own", secrets: { files: [{ name: "s", source: "/etc/passwd" }] } },
        file,
      ),
    ).toContain(
      `${file}.secrets.files[0].source: expected a relative path inside the project such as ./config or ./file.txt`,
    );
  });
});

describe("configsErrors", () => {
  const file = "services/main/app/service.json";

  it("accepts valid configs and reports malformed entries", () => {
    expect(configsErrors({}, file)).toEqual([]);
    expect(configsErrors({ configs: null }, file)).toEqual([]);
    expect(
      configsErrors(
        {
          appType: "bring-your-own",
          configs: [
            {
              name: "app_cfg",
              source: "./config.json",
              target: "/etc/config.json",
            },
          ],
        },
        file,
      ),
    ).toEqual([]);

    expect(configsErrors({ appType: "bring-your-own", configs: "not-an-array" }, file)).toEqual([
      `${file}.configs: expected an array of { name, source, target }`,
    ]);
    expect(
      configsErrors(
        { appType: "bring-your-own", configs: [{ name: "bad name", source: "./s.txt" }] },
        file,
      ),
    ).toContain(
      `${file}.configs[0].name: "bad name" is not a valid config identifier name (letters, digits, dashes, dots and underscores)`,
    );
  });
});

describe("secret and config file entries", () => {
  const file = "services/main/app/service.json";
  const cfg = (entry: Record<string, unknown>) =>
    configsErrors({ appType: "bring-your-own", configs: [{ name: "c", ...entry }] }, file);

  it("rejects them on resources that are not bring-your-own", () => {
    expect(secretsErrors({ secrets: { files: [{ name: "s", source: "./s" }] } }, file)).toEqual([
      `${file}.secrets.files: only applies to bring-your-own resources (appType "bring-your-own")`,
    ]);
    expect(configsErrors({ appType: "backend", configs: [] }, file)).toEqual([
      `${file}.configs: only applies to bring-your-own resources (appType "bring-your-own")`,
    ]);
  });

  it("rejects unknown keys", () => {
    expect(cfg({ source: "./c", path: "/c" })).toEqual([
      `${file}.configs[0].path: unknown option (use name, source, target, uid, gid, mode)`,
    ]);
  });

  it("accepts nested relative sources and rejects a bare dot", () => {
    expect(cfg({ source: "docker/local/settings.ini" })).toEqual([]);
    expect(cfg({ source: "../docker/local/settings.ini" })).toEqual([]);
    expect(cfg({ source: ".env" })).toEqual([]);
    expect(cfg({ source: "." })).toHaveLength(1);
    expect(cfg({ source: "docker/../../x" })).toHaveLength(1);
  });

  it("accepts integer modes from 0 to 4095 only", () => {
    expect(cfg({ source: "./c", mode: 0 })).toEqual([]);
    expect(cfg({ source: "./c", mode: 4095 })).toEqual([]);
    for (const mode of [-1, 4096, 1.5]) {
      expect(cfg({ source: "./c", mode })).toHaveLength(1);
    }
  });
});

describe("containerErrors", () => {
  const file = "services/main/vpn/service.json";
  const byo = (container: unknown) => ({ appType: "bring-your-own", container });

  it("accepts the Compose options a real image needs, and an absent value", () => {
    expect(containerErrors({ appType: "bring-your-own" }, file)).toEqual([]);
    expect(
      containerErrors(
        byo({
          command: ["server", "/data", "--console-address", ":9001"],
          capAdd: ["NET_ADMIN"],
          capDrop: ["ALL"],
          init: false,
          readOnly: true,
          user: "10001:10001",
          securityOpt: ["no-new-privileges:true"],
          shmSize: "256mb",
        }),
        file,
      ),
    ).toEqual([]);
  });

  it("accepts an entrypoint, including an empty one that drops the image's ENTRYPOINT", () => {
    for (const entrypoint of [["/docker-entrypoint.sh"], ["sh", "-c", 'exec "$$@"'], []]) {
      expect(
        containerErrors({ appType: "bring-your-own", container: { entrypoint } }, file),
      ).toEqual([]);
    }
    expect(
      containerErrors({ appType: "bring-your-own", container: { command: [] } }, file),
    ).toHaveLength(1);
  });

  it("accepts a newline and a tab in a command or entrypoint word, a multi-line sh -c script", () => {
    const script = 'set -eu\nlog() { echo "x: $$1"; }\n\tlog done\n';
    for (const container of [
      { command: ["sh", "-c", script] },
      { entrypoint: ["sh", "-c", script, "--"] },
    ]) {
      const manifest = { appType: "bring-your-own", container };
      expect(containerErrors(manifest, file)).toEqual([]);
      expect(validateGeneratedStringFields(manifest, file)).toEqual([]);
    }
  });

  it("still refuses a line break in any other string of the manifest", () => {
    const manifest = {
      appType: "bring-your-own",
      container: { command: ["sh", "-c", "a\nb"] },
      env: { A: "x\nprivileged: true" },
    };
    expect(validateGeneratedStringFields(manifest, file)).toEqual([
      `${file}.env.A: must not contain line breaks or control characters`,
    ]);
  });

  it("refuses container on a resource Flisk builds itself", () => {
    expect(containerErrors({ appType: "backend", container: { readOnly: true } }, file)).toEqual([
      `${file}.container: only applies to bring-your-own resources (appType "bring-your-own")`,
    ]);
  });

  it.each([
    [byo("NET_ADMIN"), "container: expected an object"],
    [byo({ capAdd: "NET_ADMIN" }), "container.capAdd: expected a list"],
    [byo({ capAdd: ["net_admin"] }), "container.capAdd: expected a list"],
    [byo({ capDrop: ["ALL\nprivileged: true"] }), "container.capDrop: expected a list"],
    [byo({ command: "server /data" }), "container.command: expected a list"],
    [byo({ command: [] }), "container.command: expected a list"],
    [byo({ command: ["sh", ""] }), "container.command: expected a list"],
    [byo({ command: ["sh", "a\rb"] }), "container.command: expected a list"],
    [byo({ command: ["sh", "a\u0000b"] }), "container.command: expected a list"],
    [byo({ command: ["sh", "a\u2028b"] }), "container.command: expected a list"],
    [byo({ entrypoint: "/entry.sh" }), "container.entrypoint: expected a list"],
    [byo({ entrypoint: [""] }), "container.entrypoint: expected a list"],
    [byo({ entrypoint: ["sh", "a\rb"] }), "container.entrypoint: expected a list"],
    [byo({ entrypoint: ["sh", 3] }), "container.entrypoint: expected a list"],
    [byo({ readOnly: "yes" }), "container.readOnly: expected true or false"],
    [byo({ init: 1 }), "container.init: expected true or false"],
    [byo({ user: "root\nprivileged: true" }), "container.user: expected a user"],
    [byo({ securityOpt: ['seccomp="x"'] }), "container.securityOpt: expected a list"],
    [byo({ shmSize: "lots" }), "container.shmSize: expected a size"],
    [byo({ privileged: true }), "container.privileged: unknown option"],
  ])("reports %j", (manifest, message) => {
    const errors = containerErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("accepts GPUs, CPU and memory limits and IPC for a model server or simulator", () => {
    expect(
      containerErrors(
        byo({ gpus: "all", cpus: 8, memory: "32g", ipc: "host", shmSize: "16g" }),
        file,
      ),
    ).toEqual([]);
    expect(containerErrors(byo({ gpus: 2, cpus: "2.5", memory: "512mb" }), file)).toEqual([]);
  });

  it.each([
    [{ gpus: 0 }, 'container.gpus: expected "all" or a GPU count of 1 or more'],
    [{ gpus: "nvidia" }, "container.gpus: expected"],
    [{ gpus: 1.5 }, "container.gpus: expected"],
    [{ cpus: 0 }, "container.cpus: expected a CPU count above 0"],
    [{ cpus: "0.0" }, "container.cpus: expected"],
    [{ cpus: "1.234" }, "container.cpus: expected"],
    [{ cpus: "4\nprivileged: true" }, "container.cpus: expected"],
    [{ memory: "lots" }, "container.memory: expected a size such as 8g"],
    [{ memory: "0g" }, "container.memory: expected"],
    [{ ipc: "container:other" }, "container.ipc: expected one of host, private, shareable, none"],
  ])("refuses the GPU or HPC option %j", (container, message) => {
    const errors = containerErrors(byo(container), file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("is part of validateServiceManifest", () => {
    const result = validateServiceManifest(
      {
        appName: "vpn",
        appType: "bring-your-own",
        stack: "main",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
        image: "example/vpn:1",
        container: { capAdd: ["NET_ADMIN"] },
      },
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("extraPortsErrors", () => {
  const file = "services/main/caddy/service.json";
  const byo = (extraPorts: unknown, more: Record<string, unknown> = {}) => ({
    appType: "bring-your-own",
    extraPorts,
    ...more,
  });

  it("accepts a proxy on 80 and 443, and an absent value", () => {
    expect(extraPortsErrors({ appType: "bring-your-own" }, file)).toEqual([]);
    expect(
      extraPortsErrors(
        byo([
          { port: 80 },
          { port: 443, hostPort: 8443, protocol: "tcp" },
          { port: 443, protocol: "udp" },
        ]),
        file,
      ),
    ).toEqual([]);
  });

  it.each([
    [byo(80), "extraPorts: expected a list"],
    [{ appType: "backend", extraPorts: [{ port: 80 }] }, "only applies to bring-your-own"],
    [byo([80]), "extraPorts[0]: expected an object"],
    [byo([{ port: 0 }]), "extraPorts[0].port: expected a port number"],
    [byo([{ port: "80" }]), "extraPorts[0].port: expected a port number"],
    [byo([{ port: 80, hostPort: 70000 }]), "extraPorts[0].hostPort: expected a port number"],
    [byo([{ port: 53, protocol: "sctp" }]), "extraPorts[0].protocol: expected tcp or udp"],
    [byo([{ port: 80, bind: "192.168.1.5" }]), "extraPorts[0].bind: expected 127.0.0.1 or 0.0.0.0"],
    [byo([{ port: 80, host: "0.0.0.0" }]), "extraPorts[0].host: unknown option"],
    [
      byo([{ port: 80 }, { port: 8080, hostPort: 80 }]),
      "extraPorts[1].hostPort: 80/tcp is published twice",
    ],
    [byo([{ port: 80 }], { replicas: 2 }), "extraPorts: needs a single container"],
  ])("reports %j", (manifest, message) => {
    const errors = extraPortsErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });
});

describe("extraPortsErrors publish", () => {
  const file = "services/main/caddy/service.json";
  const publish = (value: unknown, more: Record<string, unknown> = {}) => ({
    appType: "bring-your-own",
    extraPorts: [{ port: 80, publish: value, ...more }],
  });

  it.each([
    "${TUBEHAUS_HTTP_BIND:-0.0.0.0:80}",
    "${TUBEHAUS_HTTP_BIND:-80}",
    "127.0.0.1:${TUBEHAUS_HTTP_PORT:-8080}",
    "${CODECOV_PORT-8080}",
    "${REDIS_PORT}",
    "127.0.0.1:${REDIS_PORT}",
    "${A:-80}${B}",
    "127.0.0.1:${CODECOV_PORT-8080}",
    "8080",
    "0.0.0.0:80",
  ])("accepts %s", (value) => {
    expect(extraPortsErrors(publish(value), file)).toEqual([]);
  });

  it.each([
    ["${A:-}", "default of ${A} must be a port or address:port"],
    ["${A-}", "default of ${A} must be a port or address:port"],
    ["${A-localhost:80}", "default of ${A} must be a port or address:port"],
    ["${A-80\nprivileged: true}", "default of ${A} must be a port or address:port"],
    ["${A:-80", "closing }"],
    ["${1A:-80}", "variable names"],
    ["${A:-localhost:80}", "default of ${A} must be a port or address:port"],
    ["${A:-0}", "must give a port or address:port"],
    ["${A:-65536}", "must give a port or address:port"],
    ["${A:-300.0.0.1:80}", "must give a port or address:port"],
    ["${A:-1.2.3:80}", "must give a port or address:port"],
    ["${A:-1:2:3}", "must give a port or address:port"],
    ["[::1]:80", "digits, '.', ':'"],
    ['0.0.0.0:80"\nprivileged: true', "digits, '.', ':'"],
    ["0.0.0.0:80\\", "digits, '.', ':'"],
    ["${A:-80}\nx", "digits, '.', ':'"],
    ["${A}:x", "digits, '.', ':'"],
    ["${A-}", "default of ${A} must be a port or address:port"],
    ["", "expected a string"],
    [80, "expected a string"],
  ])("refuses %j", (value, message) => {
    const errors = extraPortsErrors(publish(value), file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(".publish");
    expect(errors[0]).toContain(message);
  });

  it("substitutes ${A-default} only when A is unset, and ${A:-default} also when A is empty, like Compose", () => {
    const lookup = (values: Record<string, string>) => (name: string) => values[name];
    expect(substitutePublish("${A-8080}", lookup({}))).toBe("8080");
    expect(substitutePublish("${A-8080}", lookup({ A: "9090" }))).toBe("9090");
    expect(substitutePublish("${A-8080}", lookup({ A: "" }))).toBe("");
    expect(substitutePublish("${A:-8080}", lookup({ A: "" }))).toBe("8080");
    expect(substitutePublish("127.0.0.1:${A-80}:${B:-81}", lookup({}))).toBe("127.0.0.1:80:81");
  });

  it("still checks the protocol when the host port comes from a variable", () => {
    const errors = extraPortsErrors(publish("${PORT}", { protocol: "sctp" }), file);
    expect(errors).toEqual([`${file}.extraPorts[0].protocol: expected tcp or udp`]);
  });

  it("counts a literal host port behind a variable address in the published-twice check", () => {
    const manifest = {
      appType: "bring-your-own",
      extraPorts: [
        { port: 80, publish: "${HOST}:80" },
        { port: 8080, hostPort: 80 },
      ],
    };
    expect(extraPortsErrors(manifest, file)[0]).toContain("80/tcp is published twice");
    // A port that comes from a variable cannot be compared.
    expect(
      extraPortsErrors(
        {
          appType: "bring-your-own",
          extraPorts: [
            { port: 80, publish: "${A}" },
            { port: 81, publish: "${B}" },
          ],
        },
        file,
      ),
    ).toEqual([]);
  });

  it.each([
    "127.0.0.1:65536${A}",
    "${A}65536",
    "${A}:65536",
    "127.0.0.1:123456${A}",
    "${HOST}:",
    "${HOST}:0",
  ])("refuses the host port that can never be valid in %s", (value) => {
    const errors = extraPortsErrors(publish(value), file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(".publish");
  });

  it("refuses publish next to hostPort or bind", () => {
    expect(extraPortsErrors(publish("${A:-80}", { hostPort: 81 }), file)).toEqual([
      `${file}.extraPorts[0].publish: replaces hostPort and bind; remove them`,
    ]);
    expect(extraPortsErrors(publish("${A:-80}", { bind: "0.0.0.0" }), file)[0]).toContain(
      "replaces hostPort and bind",
    );
  });

  it("counts the default host port when it looks for a port published twice", () => {
    const manifest = {
      appType: "bring-your-own",
      extraPorts: [
        { port: 80, publish: "${A:-0.0.0.0:80}" },
        { port: 81, hostPort: 80 },
      ],
    };
    expect(extraPortsErrors(manifest, file)[0]).toContain("80/tcp is published twice");
  });
});

describe("sidecarErrors", () => {
  const file = "services/main/bgutil/service.json";
  const byo = (more: Record<string, unknown>) => ({
    appName: "bgutil",
    appType: "bring-your-own",
    ...more,
  });

  it("accepts a sidecar of another resource, and an absent value", () => {
    expect(sidecarErrors(byo({}), file)).toEqual([]);
    expect(sidecarErrors(byo({ sidecarOf: "tubehaus" }), file)).toEqual([]);
  });

  it.each([
    [{ appType: "backend", sidecarOf: "tubehaus" }, "only applies to bring-your-own"],
    [byo({ sidecarOf: 7 }), "expected the appName"],
    [byo({ sidecarOf: "Tube Haus" }), "expected the appName"],
    [byo({ sidecarOf: 'x"\nprivileged: true' }), "expected the appName"],
    [byo({ sidecarOf: "bgutil" }), "cannot name the resource itself"],
    [byo({ sidecarOf: "tubehaus", extraPorts: [{ port: 4416 }] }), "has no ports of its own"],
    [byo({ sidecarOf: "tubehaus", replicas: 2 }), "needs a single container"],
  ])("reports %j", (manifest, message) => {
    const errors = sidecarErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });
});
