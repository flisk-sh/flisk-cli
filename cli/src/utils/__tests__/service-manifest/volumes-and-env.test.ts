// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import {
  containerErrors,
  envFileErrors,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  validateServiceManifest,
  volumesErrors,
} from "../../service-manifest.js";

describe("volumesErrors", () => {
  const file = "services/tube/tubehaus/service.json";
  const byo = (volumes: unknown) => ({ appType: "bring-your-own", volumes });

  it("accepts named volumes, bind mounts and read-only, and an absent value", () => {
    expect(volumesErrors({ appType: "bring-your-own" }, file)).toEqual([]);
    expect(
      volumesErrors(
        byo([
          { source: "tubehaus-data", target: "/data" },
          { source: "./config", target: "/etc/app", readOnly: true },
          { source: "../shared/web", target: "/srv/web", readOnly: true },
          { source: "library", target: "/library", name: "tubehaus_tubehaus-data" },
        ]),
        file,
        3,
      ),
    ).toEqual([]);
  });

  it.each([
    [byo("data:/data"), "volumes: expected a list"],
    [
      { appType: "backend", volumes: [{ source: "data", target: "/data" }] },
      "only applies to bring-your-own",
    ],
    [byo(["data:/data"]), "volumes[0]: expected an object"],
    [byo([{ source: "/etc", target: "/etc" }]), "volumes[0].source: expected a volume name"],
    [byo([{ source: "Data", target: "/data" }]), "volumes[0].source: expected a volume name"],
    [
      byo([{ source: "data\nprivileged: true", target: "/data" }]),
      "volumes[0].source: expected a volume name",
    ],
    [byo([{ source: "data", target: "data" }]), "volumes[0].target: expected an absolute path"],
    [
      byo([{ source: "data", target: "/data/../etc" }]),
      "volumes[0].target: expected an absolute path",
    ],
    [
      byo([
        { source: "a", target: "/data" },
        { source: "b", target: "/data" },
      ]),
      "/data is mounted twice",
    ],
    [
      byo([{ source: "data", target: "/data", readOnly: "yes" }]),
      "volumes[0].readOnly: expected true or false",
    ],
    [
      byo([{ source: "data", target: "/data", driver: "nfs" }]),
      "volumes[0].driver: unknown option",
    ],
    [
      byo([{ source: "data", target: "/data", name: "x\nexternal: true" }]),
      "volumes[0].name: expected a Docker volume name",
    ],
    [
      byo([{ source: "./conf", target: "/conf", name: "conf" }]),
      "volumes[0].name: only applies to a named volume",
    ],
  ])("reports %j", (manifest, message) => {
    const errors = volumesErrors(manifest, file, 3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("refuses a bind mount that climbs out of the project, once its location is known", () => {
    const climbing = byo([{ source: "../../../../etc", target: "/host-etc" }]);
    expect(volumesErrors(climbing, file)).toEqual([]);
    expect(volumesErrors(climbing, file, 3)).toEqual([
      `${file}.volumes[0].source: must stay inside the project`,
    ]);
    expect(volumesErrors(byo([{ source: "../../..", target: "/project" }]), file, 3)).toEqual([]);
  });
});

describe("container.tmpfs", () => {
  const file = "services/main/app/service.json";
  const byo = (tmpfs: unknown) => ({ appType: "bring-your-own", container: { tmpfs } });

  it("accepts paths with and without mount options", () => {
    expect(
      containerErrors(byo(["/tmp:noexec,nosuid,nodev,size=100m", "/run", "/var/cache/app"]), file),
    ).toEqual([]);
  });

  it.each([
    [byo("/tmp"), "container.tmpfs: expected a list"],
    [byo(["tmp"]), "container.tmpfs: expected a list"],
    [byo(["/tmp/../etc"]), "container.tmpfs: expected a list"],
    [byo(["/tmp:"]), "container.tmpfs: expected a list"],
    [byo(["/tmp:SIZE=1"]), "container.tmpfs: expected a list"],
    [byo(["/tmp\nprivileged: true"]), "container.tmpfs: expected a list"],
    [byo(["/tmp:size=1m\nprivileged: true"]), "container.tmpfs: expected a list"],
    [byo(['/tmp:size="1m"']), "container.tmpfs: expected a list"],
  ])("reports %j", (manifest, message) => {
    const errors = containerErrors(manifest, file);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });
});

describe("envFileErrors", () => {
  const file = "services/main/app/service.json";
  const byo = (envFile: unknown) => ({ appType: "bring-your-own", envFile });

  it("accepts paths that stay inside the project, and an absent value", () => {
    expect(envFileErrors({ appType: "bring-your-own" }, file, 3)).toEqual([]);
    expect(envFileErrors(byo(["../../../.env", "./app.env", "config/app.env"]), file, 3)).toEqual(
      [],
    );
    expect(envFileErrors(byo(["../../../../.env"]), file)).toEqual([]);
  });

  it.each([
    [byo("../.env"), "envFile: expected a list"],
    [{ appType: "backend", envFile: [".env"] }, "only applies to bring-your-own"],
    [byo([".env\nprivileged: true"]), "envFile[0]: expected a relative file path"],
    [byo(["/etc/passwd"]), "envFile[0]: expected a relative file path"],
    [byo(["a b"]), "envFile[0]: expected a relative file path"],
    [byo(["../../../../.env"]), "envFile[0]: must stay inside the project"],
    [byo([42]), "envFile[0]: expected a relative file path"],
  ])("reports %j", (manifest, message) => {
    const errors = envFileErrors(manifest, file, 3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it("is part of validateServiceManifest", () => {
    const result = validateServiceManifest(
      {
        appName: "app",
        appType: "bring-your-own",
        stack: "main",
        schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
        image: "example/app:1",
        envFile: ["../../../.env"],
        container: { tmpfs: ["/tmp:noexec"] },
      },
      file,
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
