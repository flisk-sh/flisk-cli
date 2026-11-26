// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// DRY_RUN_PLAN, REJECTED_PLAN and TILTFILE_PLAN are real flisk-import@0.18.3 output (the pinned
// IMPORT_PACKAGE), captured from `npx flisk-import@0.18.3 --dry-run` on fixture Compose projects, so
// the parser is tested against the format the pin actually prints.
import { describe, expect, it } from "vitest";
import { parseImportPlan } from "../plan.js";
import { importReport } from "../run.js";

const DRY_RUN_PLAN = [
  "Found 3 service(s) and 0 job(s) in /private/tmp/flisk-import-fixture/legacy",
  "Read only: docker-compose.yml. Lines below name what was not translated.",
  "",
  "  .flisk/project.json  [create Flisk project]",
  "",
  "  db  (service)",
  "    from:      docker-compose.yml [compose]",
  "    image:     postgres:16",
  "    port:      4000 (assigned)",
  "    proxy:     none, private (no single published port)",
  "    env:       POSTGRES_DB, POSTGRES_PASSWORD (names only)",
  "    write:     services/legacy/db/service.json  [create]",
  "",
  "  web  (service)",
  "    from:      docker-compose.yml [compose]",
  "    image:     nginx:alpine",
  "    port:      80 (from Compose)",
  "    proxy:     routed through Traefik",
  "    health:    / (assumed)",
  "    depends:   api",
  "    write:     services/legacy/web/service.json  [create]",
  "    note:      health path / is assumed: no HTTP health path could be read from Compose. Traefik routes only while it answers 2xx or 3xx",
  "",
  "  api  (service, api/)",
  "    from:      docker-compose.yml [compose]",
  "    build:     api/ with Dockerfile",
  "    port:      3000 (from Compose)",
  "    proxy:     routed through Traefik",
  "    health:    / (assumed)",
  "    depends:   db",
  "    env:       DATABASE_URL (names only)",
  "    write:     services/legacy/api/service.json  [create]",
  "    note:      health path / is assumed: no HTTP health path could be read from Compose. Traefik routes only while it answers 2xx or 3xx",
  "    note:      published as Compose's bare mapping, on every interface (IPv4 and IPv6): 8080->3000/tcp (flisk doctor lists these)",
  "",
  "Skipped / not fully imported:",
  "  docker-compose.yml [compose]: restart not set for db, api, web: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
  "",
  "Dry run: nothing written.",
].join("\n");

const HEALTH_NOTE =
  "health path / is assumed: no HTTP health path could be read from Compose. Traefik routes only while it answers 2xx or 3xx";

const REJECTED_PLAN = [
  "Found 2 service(s) and 0 job(s) in /private/tmp/flisk-import-fixture/broken",
  "Read only: docker-compose.yml. Lines below name what was not translated.",
  "",
  "  .flisk/project.json  [create Flisk project]",
  "",
  "  bad  (service)",
  "    from:      docker-compose.yml [compose]",
  "",
  "  good  (service)",
  "    from:      docker-compose.yml [compose]",
  "    image:     redis:7",
  "    port:      4000 (assigned)",
  "    proxy:     none, private (no single published port)",
  "    write:     services/broken/good/service.json  [create]",
  "",
  "  not written: bad: Compose gives it neither `image` nor a usable `build`",
  "",
  "Skipped / not fully imported:",
  "  compose.override.yaml [compose]: not applied; `docker compose up` merges it over docker-compose.yml, flisk import does not",
  "  docker-compose.yml [compose]: restart not set for good: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
  "",
  "Dry run: nothing written.",
].join("\n");

const TILTFILE_PLAN = [
  "Found Tiltfile in /private/tmp/flisk-import-fixture/tiltdir",
  "The Tiltfile is not changed: flisk up runs it as it is.",
  "",
  "  .flisk/project.json  [create Flisk project]",
  '    orchestration:  {"source":"tiltfile","path":"Tiltfile"}',
  "",
  "Dry run: nothing written.",
].join("\n");

/** A one-service plan in the importer's format, with the write status the case needs. */
const servicePlan = (status: string, extraFields: string[] = []) =>
  [
    "Found 1 service(s) and 0 job(s) in /tmp/legacy",
    "Read only: docker-compose.yml. Lines below name what was not translated.",
    "",
    "  db  (service)",
    "    image:     postgres:16",
    ...extraFields,
    `    write:     services/legacy/db/service.json  [${status}]`,
    "",
  ].join("\n");

describe("parseImportPlan", () => {
  it("parses every service's fields, the skips and the planned paths of a dry-run plan", () => {
    const plan = parseImportPlan(DRY_RUN_PLAN);
    expect(plan.services).toEqual([
      {
        name: "db",
        kind: "service",
        image: "postgres:16",
        port: 4000,
        proxy: "none",
        dependsOn: [],
        write: { path: "services/legacy/db/service.json", action: "create" },
        notes: [],
      },
      {
        name: "web",
        kind: "service",
        image: "nginx:alpine",
        port: 80,
        proxy: "traefik",
        healthCheckPath: "/",
        healthCheckAssumed: true,
        dependsOn: ["api"],
        write: { path: "services/legacy/web/service.json", action: "create" },
        notes: [HEALTH_NOTE],
      },
      {
        name: "api",
        kind: "service",
        dir: "api",
        build: { context: "api", dockerfile: "Dockerfile" },
        port: 3000,
        proxy: "traefik",
        healthCheckPath: "/",
        healthCheckAssumed: true,
        dependsOn: ["db"],
        write: { path: "services/legacy/api/service.json", action: "create" },
        notes: [
          HEALTH_NOTE,
          "published as Compose's bare mapping, on every interface (IPv4 and IPv6): 8080->3000/tcp (flisk doctor lists these)",
        ],
      },
    ]);
    expect(plan.skipped).toEqual([
      {
        source: "docker-compose.yml",
        detector: "compose",
        reason:
          "restart not set for db, api, web: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
      },
    ]);
    // .flisk/project.json first, then the service manifests in plan order.
    expect(plan.planned).toEqual([
      ".flisk/project.json",
      "services/legacy/db/service.json",
      "services/legacy/web/service.json",
      "services/legacy/api/service.json",
    ]);
  });

  it.each([
    ["create", "create", true],
    ["overwrite (--force)", "overwrite", true],
    ["exists, kept (use --force to overwrite)", "exists-kept", false],
  ])("maps the write status [%s] to action %s, planned: %s", (status, action, isPlanned) => {
    const plan = parseImportPlan(servicePlan(status));
    expect(plan.services[0]?.write).toEqual({
      path: "services/legacy/db/service.json",
      action,
    });
    expect(plan.planned).toEqual(isPlanned ? ["services/legacy/db/service.json"] : []);
  });

  it("keeps a rejected service with its 'not written' reason and no write", () => {
    const plan = parseImportPlan(REJECTED_PLAN);
    expect(plan.services).toHaveLength(2);
    expect(plan.services[0]).toEqual({
      name: "bad",
      kind: "service",
      dependsOn: [],
      notes: [],
      notWrittenReason: "Compose gives it neither `image` nor a usable `build`",
    });
    expect(plan.services[1]?.write?.action).toBe("create");
    expect(plan.planned).toEqual([".flisk/project.json", "services/broken/good/service.json"]);
  });

  it("reads every 'Skipped / not fully imported' line with its detector", () => {
    expect(parseImportPlan(REJECTED_PLAN).skipped).toEqual([
      {
        source: "compose.override.yaml",
        detector: "compose",
        reason:
          "not applied; `docker compose up` merges it over docker-compose.yml, flisk import does not",
      },
      {
        source: "docker-compose.yml",
        detector: "compose",
        reason:
          "restart not set for good: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
      },
    ]);
  });

  it("reads a Tiltfile registration plan as one planned file and no services", () => {
    expect(parseImportPlan(TILTFILE_PLAN)).toEqual({
      services: [],
      skipped: [],
      planned: [".flisk/project.json"],
    });
  });

  it.each([
    "",
    "Dry run: nothing written.",
    "Nothing to write: every service.json already exists.",
  ])("returns empty fields for output that is not a plan: %j", (stdout) => {
    expect(parseImportPlan(stdout)).toEqual({ services: [], skipped: [], planned: [] });
  });

  it("leaves out what it does not know instead of guessing", () => {
    const plan = parseImportPlan(
      servicePlan("deferred", [
        "    mystery:   whatever a future importer prints",
        "    port:      not a number",
        "    proxy:     somewhere else entirely",
        "    health:    /healthz",
      ]),
    );
    expect(plan.services[0]).toEqual({
      name: "db",
      kind: "service",
      image: "postgres:16",
      healthCheckPath: "/healthz",
      dependsOn: [],
      write: undefined,
      notes: [],
    });
  });

  it("reads a health path without the (assumed) marker as given", () => {
    const plan = parseImportPlan(servicePlan("create", ["    health:    /ready"]));
    expect(plan.services[0]?.healthCheckPath).toBe("/ready");
    expect(plan.services[0]?.healthCheckAssumed).toBeUndefined();
  });
});

describe("importReport plan fields", () => {
  it("carries the parsed plan next to written on a dry-run report", () => {
    const report = importReport(["./legacy", "--dry-run", "--yes"], {
      exitCode: 0,
      stdout: DRY_RUN_PLAN,
      stderr: "",
    });
    expect(report).toMatchObject({
      dir: "./legacy",
      dryRun: true,
      written: [],
      output: DRY_RUN_PLAN.trim(),
    });
    expect(report.services).toHaveLength(3);
    expect(report.skipped).toHaveLength(1);
    expect(report.planned).toHaveLength(4);
  });

  it("keeps written and planned apart on a run that wrote", () => {
    const stdout = `${servicePlan("create")}  wrote services/legacy/db/service.json\n\nWrote 1 service.json file(s) and created .flisk/project.json.\n`;
    const report = importReport([".", "--yes"], { exitCode: 0, stdout, stderr: "" });
    expect(report.written).toEqual(["services/legacy/db/service.json"]);
    expect(report.planned).toEqual(["services/legacy/db/service.json"]);
    expect(report.services[0]?.write).toEqual({
      path: "services/legacy/db/service.json",
      action: "create",
    });
  });
});
