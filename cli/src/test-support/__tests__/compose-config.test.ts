// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { compareConfigModels } from "../compose-config.js";

/**
 * The parity rules in compose-config.ts, checked on canned `docker compose config` models: no Docker needed.
 * `original` stands for the adopter's file, `generated` for what `flisk export compose` writes. The shapes below
 * mirror the real pipeline: kebab renames carry the old name as a network alias, the generated file adds `init`,
 * `name` and explicit volume names, and `depends_on` targets follow the rename.
 */

function kinds(report: ReturnType<typeof compareConfigModels>): {
  documented: string[];
  differences: string[];
} {
  return {
    documented: report.documented.map((finding) => finding.kind),
    differences: report.differences.map((finding) => finding.kind),
  };
}

describe("compareConfigModels", () => {
  it("reports parity for identical models", () => {
    const model = {
      name: "shop",
      services: { api: { image: "node:22", restart: "unless-stopped" } },
    };
    const report = compareConfigModels(model, structuredClone(model));
    expect(report.differences).toEqual([]);
    expect(report.documented).toEqual([]);
  });

  it("matches renamed services by kebab-case and expects the old name as an alias", () => {
    const report = compareConfigModels(
      {
        services: {
          lychee_api: {
            image: "img",
            networks: { lychee: null },
            depends_on: { lychee_db: { condition: "service_healthy" } },
          },
          lychee_db: { image: "db", networks: { lychee: null } },
        },
        networks: { lychee: { name: "lychee" } },
      },
      {
        services: {
          "lychee-api": {
            image: "img",
            networks: { default: { aliases: ["lychee_api"] } },
            depends_on: { "lychee-db": { condition: "service_healthy" } },
          },
          "lychee-db": { image: "db", networks: { default: { aliases: ["lychee_db"] } } },
        },
      },
    );
    expect(report.differences).toEqual([]);
    expect(kinds(report).documented).toEqual(expect.arrayContaining(["service-name", "networks"]));
  });

  it("fails when a renamed service loses its old name alias", () => {
    const report = compareConfigModels(
      { services: { lychee_api: { image: "img" } } },
      { services: { "lychee-api": { image: "img" } } },
    );
    expect(kinds(report).differences).toContain("networks");
  });

  it("treats the documented defaults as documented, not differences", () => {
    const report = compareConfigModels(
      {
        services: {
          api: {
            image: "img",
            container_name: "my-api",
            env_file: [{ path: "/p/.env", required: true }],
          },
        },
      },
      {
        name: "p",
        services: {
          api: {
            image: "img",
            init: true,
            restart: "unless-stopped",
            env_file: [{ path: "/p/.env", required: false }],
          },
        },
      },
    );
    expect(report.differences).toEqual([]);
    expect(kinds(report).documented).toEqual(
      expect.arrayContaining([
        "project-name",
        "container_name",
        "init",
        "restart-default",
        "env_file",
      ]),
    );
  });

  it("normalizes the string, CMD-SHELL and CMD sh -c healthcheck forms", () => {
    const report = compareConfigModels(
      {
        services: {
          db: { image: "db", healthcheck: { test: "pg_isready" } },
          web: { image: "img", healthcheck: { test: ["CMD-SHELL", "curl -f x"] } },
        },
      },
      {
        services: {
          db: { image: "db", healthcheck: { test: ["CMD", "sh", "-c", "pg_isready"] } },
          web: { image: "img", healthcheck: { test: ["CMD", "sh", "-c", "curl -f x"] } },
        },
      },
    );
    expect(report.differences).toEqual([]);
  });

  it("compares explicit volume names and drivers against Compose defaults", () => {
    const report = compareConfigModels(
      { name: "nosia", volumes: { "db-data": null } },
      { name: "nosia", volumes: { "db-data": { name: "nosia_db-data" } } },
    );
    expect(report.differences).toEqual([]);
  });

  it("documents a dropped image only while the service keeps its build", () => {
    const original = {
      services: { app: { image: "img:1", build: { context: "/p" } } },
    };
    const kept = compareConfigModels(original, {
      services: { app: { build: { context: "/p", dockerfile: "Dockerfile" } } },
    });
    expect(kept.differences).toEqual([]);
    expect(kinds(kept).documented).toContain("image-with-build");

    const swapped = compareConfigModels(original, {
      services: { app: { image: "other:2", build: { context: "/p", dockerfile: "Dockerfile" } } },
    });
    expect(swapped.differences).not.toEqual([]);
  });

  it("documents dropped deploy reservations but compares limits", () => {
    const original = {
      services: {
        api: {
          image: "img",
          deploy: { resources: { limits: { cpus: "2" }, reservations: { memory: "512M" } } },
        },
      },
    };
    const ok = compareConfigModels(original, {
      services: { api: { image: "img", deploy: { resources: { limits: { cpus: "2" } } } } },
    });
    expect(ok.differences).toEqual([]);
    expect(kinds(ok).documented).toContain("deploy-reservations");

    const changed = compareConfigModels(original, {
      services: { api: { image: "img", deploy: { resources: { limits: { cpus: "4" } } } } },
    });
    expect(changed.differences).not.toEqual([]);
  });

  it("surfaces undocumented changes as differences", () => {
    const report = compareConfigModels(
      { services: { api: { image: "img:1", environment: { PORT: "3000" } } } },
      { services: { api: { image: "img:2", environment: { PORT: "3000" } } } },
    );
    expect(report.differences.map((finding) => finding.message).join("\n")).toContain(
      'service "api".image',
    );
  });

  it("flags a missing service and an added service as differences", () => {
    const missing = compareConfigModels(
      { services: { api: { image: "img" }, db: { image: "db" } } },
      { services: { api: { image: "img" } } },
    );
    expect(kinds(missing).differences).toContain("service-missing");

    const extra = compareConfigModels(
      { services: { api: { image: "img" } } },
      { services: { api: { image: "img" }, sidecar: { image: "s" } } },
    );
    expect(kinds(extra).differences).toContain("service-extra");
  });

  it("normalizes the short, long and variable port spellings", () => {
    const report = compareConfigModels(
      {
        services: {
          web: { image: "i", ports: ["8080:80", "${PORT:-9090}:90", 3000] },
        },
      },
      {
        services: {
          web: {
            image: "i",
            ports: [{ target: 80, published: 8080, protocol: "tcp" }, "${PORT:-9090}:90/tcp", 3000],
          },
        },
      },
    );
    expect(report.differences).toEqual([]);
  });

  it("compares shell-form commands with the exec list the importer writes", () => {
    const report = compareConfigModels(
      { services: { job: { image: "img", command: "bundle exec rake work" } } },
      { services: { job: { image: "img", command: ["bundle", "exec", "rake", "work"] } } },
    );
    expect(report.differences).toEqual([]);
  });

  it("reads environment values as the strings Compose hands the container", () => {
    const original = {
      services: {
        proxy: { image: "img", environment: { MAX_RES: 16.8, FLAG: true } },
      },
    };
    const equal = compareConfigModels(original, {
      services: {
        proxy: { image: "img", environment: { MAX_RES: "16.8", FLAG: "true" } },
      },
    });
    expect(equal.differences).toEqual([]);

    const changed = compareConfigModels(original, {
      services: {
        proxy: { image: "img", environment: { MAX_RES: "8.4", FLAG: "true" } },
      },
    });
    expect(changed.differences).not.toEqual([]);
  });
});
