// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { discoverResourcesFromRoot } from "../../services.js";
import { checkPostgresVolumes, postgresImageMajor, postgresVolumeWarnings } from "../postgres.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-postgres-checks-");
const { service } = project;

const byo = { appType: "bring-your-own" };

describe("postgresImageMajor", () => {
  it.each([
    ["postgres:18-alpine", 18],
    ["postgres:17", 17],
    ["pgvector/pgvector:pg18", 18],
    ["docker.io/library/postgres:16", 16],
    ["postgres:18@sha256:abc", 18],
    ["postgres", null],
    ["postgres:bookworm", null],
    ["mysql:8", null],
    ["redis/redis-stack:latest", null],
    ["registry.local/postgres:18", null],
    ["localhost:5000/postgres:18", null],
    ["postgres:", null],
    [undefined, null],
    [18, null],
    [{ image: "postgres:18" }, null],
  ])("parses %j as %s", (image, major) => {
    expect(postgresImageMajor(image)).toBe(major);
  });
});

describe("checkPostgresVolumes", () => {
  it("warns when a Postgres 18+ image mounts its volume at the pre-18 path", () => {
    service("db", {
      ...byo,
      image: "postgres:18-alpine",
      volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data" }],
    });
    const result = checkPostgresVolumes(project.root);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("/var/lib/postgresql/data");
    expect(result.fix).toContain("/var/lib/postgresql");
  });

  it("is not a warning in strict mode", () => {
    service("db", {
      ...byo,
      image: "postgres:18",
      volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data" }],
    });
    const result = checkPostgresVolumes(project.root, undefined, true);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(false);
  });

  it("passes for Postgres 16 at the same path, and for 18 at the new path", () => {
    service("old", {
      ...byo,
      image: "postgres:16-alpine",
      volumes: [{ source: "a", target: "/var/lib/postgresql/data" }],
    });
    service("new", {
      port: 4001,
      ...byo,
      image: "postgres:18-alpine",
      volumes: [{ source: "b", target: "/var/lib/postgresql" }],
    });
    expect(checkPostgresVolumes(project.root).didPass).toBe(true);
  });
});

describe("postgresVolumeWarnings", () => {
  it("returns the warning lines the check reports", () => {
    service("db", {
      ...byo,
      image: "pgvector/pgvector:pg18",
      volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data/" }],
    });
    const warnings = postgresVolumeWarnings(project.root, discoverResourcesFromRoot(project.root));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Postgres 18");
    expect(warnings[0]).toContain("service.json");
  });

  it("skips a non-array volumes field and a subpath below the pre-18 directory", () => {
    service("db", {
      ...byo,
      image: "postgres:18",
      volumes: "pgdata",
    });
    service("sub", {
      port: 4001,
      ...byo,
      image: "postgres:18",
      volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data/nested" }],
    });
    expect(
      postgresVolumeWarnings(project.root, discoverResourcesFromRoot(project.root)),
    ).toHaveLength(0);
  });
});
