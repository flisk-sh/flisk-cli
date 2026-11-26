// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));

import { createTempDir, fakeSpawn } from "../../../test-support/index.js";
import { executeImport, runImport } from "../run.js";
import { customNetworkNames, formatCoverageBlock, importCoverageSummary } from "../summary.js";

const COVERAGE_LINK =
  "https://github.com/flisk-sh/flisk/blob/main/docs/project/ADOPTER-COVERAGE.md";

// The plan flisk-import prints for the Lychee docker-compose.yaml (trimmed to the services
// whose notes and skips the summary must pick up).
const LYCHEE_PLAN = [
  "Found 3 service(s) and 0 job(s) in /tmp/lychee",
  "Read only: docker-compose.yaml. Lines below name what was not translated.",
  "",
  "  .flisk/project.json  [create Flisk project]",
  "",
  "  lychee-api  (service)",
  "    from:      docker-compose.yaml [compose]",
  "    image:     ghcr.io/lycheeorg/lychee:latest",
  "    port:      80 (from Compose)",
  "    proxy:     routed through Traefik",
  "    write:     services/lychee/lychee-api/service.json  [create]",
  '    note:      renamed from "lychee_api" (Compose names must be lowercase kebab-case)',
  '    note:      network alias "lychee_api" keeps the Compose name, so other services that call it by that name still reach it',
  "",
  "  phpmyadmin  (service)",
  "    from:      docker-compose.yaml [compose]",
  "    image:     phpmyadmin",
  "    port:      80 (from Compose)",
  "    proxy:     routed through Traefik",
  "    health:    / (assumed)",
  "    write:     services/lychee/phpmyadmin/service.json  [create]",
  "    note:      health path / is assumed: no HTTP health path could be read from Compose. Traefik routes only while it answers 2xx or 3xx",
  "    note:      published as Compose's bare mapping, on every interface (IPv4 and IPv6): 8080->80/tcp (flisk doctor lists these)",
  "",
  "  lychee-worker  (service)",
  "    from:      docker-compose.yaml [compose]",
  "    image:     ghcr.io/lycheeorg/lychee:latest",
  "    port:      4000 (assigned)",
  "    proxy:     none, private (no single published port)",
  "    write:     services/lychee/lychee-worker/service.json  [create]",
  '    note:      renamed from "lychee_worker" (Compose names must be lowercase kebab-case)',
  "",
  "Skipped / not fully imported:",
  "  docker-compose.yaml [compose]: uses YAML anchors/aliases; values were read after resolution",
  '  docker-compose.yaml [compose]: service "lychee_api" container_name "lychee-api" is dropped: Flisk names containers itself; other services reach it by its service name',
  '  docker-compose.yaml [compose]: service "lychee_api" deploy.resources.reservations is not carried over; not used',
  '  docker-compose.yaml [compose]: service "lychee_worker" container_name "lychee-worker" is dropped: Flisk names containers itself; other services reach it by its service name',
  "  docker-compose.yaml [compose]: restart not set for phpmyadmin: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
  "",
  "Wrote 3 service.json file(s).",
  "",
].join("\n");

const LYCHEE_COMPOSE = `services:
  lychee_api:
    image: ghcr.io/lycheeorg/lychee:latest
    container_name: lychee-api
    networks:
      - lychee
    deploy:
      resources:
        reservations:
          cpus: "0.5"
  lychee_worker:
    image: ghcr.io/lycheeorg/lychee:latest
    container_name: lychee-worker
    networks:
      - lychee
  phpmyadmin:
    image: phpmyadmin
networks:
  lychee:
`;

/** Runs `run` with `file` (the importer's "Read only" name) written into a fresh temp dir. */
async function withComposeDir<T>(
  file: string,
  contents: string,
  run: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = createTempDir();
  fs.writeFileSync(path.join(dir, file), contents);
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("import coverage summary (#3108)", () => {
  it("groups the Lychee import into dropped, approximated and by design, each with its coverage anchor", async () => {
    await withComposeDir("docker-compose.yaml", LYCHEE_COMPOSE, (dir) => {
      const coverage = importCoverageSummary(LYCHEE_PLAN, { dir });
      expect(coverage.dropped).toEqual([
        {
          label:
            'service "lychee_api" container_name "lychee-api" is dropped: Flisk names containers itself; other services reach it by its service name',
          anchor: "cov-container-name",
        },
        {
          label: 'service "lychee_api" deploy.resources.reservations is not carried over; not used',
          anchor: "cov-deploy-resources-reservations",
        },
        {
          label:
            'service "lychee_worker" container_name "lychee-worker" is dropped: Flisk names containers itself; other services reach it by its service name',
          anchor: "cov-container-name",
        },
      ]);
      expect(coverage.approximated).toEqual([
        {
          label: 'custom networks "lychee" run as the default Flisk network',
          anchor: "cov-networks",
        },
        {
          label:
            'lychee-api: renamed from "lychee_api" (Compose names must be lowercase kebab-case)',
          anchor: "compose-features",
        },
        {
          label:
            'lychee-api: network alias "lychee_api" keeps the Compose name, so other services that call it by that name still reach it',
          anchor: "compose-features",
        },
        {
          label:
            "phpmyadmin: health path / is assumed: no HTTP health path could be read from Compose. Traefik routes only while it answers 2xx or 3xx",
          anchor: "compose-features",
        },
        {
          label:
            'lychee-worker: renamed from "lychee_worker" (Compose names must be lowercase kebab-case)',
          anchor: "compose-features",
        },
      ]);
      expect(coverage.byDesign).toEqual([
        {
          label:
            "restart not set for phpmyadmin: Flisk restarts them (unless-stopped), where Compose would not restart them after a crash or a reboot",
          anchor: "cov-no-restart",
        },
      ]);
      const block = formatCoverageBlock(coverage);
      expect(block).toContain("dropped:");
      expect(block).toContain("approximated:");
      expect(block).toContain("by design:");
      expect(block).toContain(`coverage: ${COVERAGE_LINK}#compose-features`);
      for (const anchor of [
        "cov-container-name",
        "cov-deploy-resources-reservations",
        "cov-networks",
        "cov-no-restart",
      ]) {
        expect(block).toContain(`docs/project/ADOPTER-COVERAGE.md#${anchor}`);
      }
    });
  });

  it("marks an outside-the-project file as by design and a rejected service as dropped", () => {
    const plan = [
      "  api  (service)",
      "    from:      docker-compose.yml [compose]",
      "    write:     services/x/api/service.json  [create]",
      "    note:      volume /srv/data:/data not written: it is outside the project",
      "  not written: worker: no free port in 4000-5999",
      "",
      "Skipped / not fully imported:",
      '  docker-compose.yml [compose]: service "api" keys not translated: scale, tty',
    ].join("\n");
    const coverage = importCoverageSummary(plan, {});
    expect(coverage.byDesign).toEqual([
      {
        label: "api: volume /srv/data:/data not written: it is outside the project",
        anchor: "cov-outside-project",
      },
    ]);
    expect(coverage.dropped).toEqual([
      {
        label: 'service "worker" not written: no free port in 4000-5999',
        anchor: "compose-features",
      },
      {
        label: 'service "api" keys not translated: scale, tty',
        anchor: "compose-features",
      },
    ]);
    expect(coverage.approximated).toEqual([]);
  });

  it("is empty for a clean import where nothing was dropped, ignored or approximated", () => {
    const clean = [
      "Plan for ./legacy (stack legacy):",
      "  api   create  services/legacy/api/service.json",
      "  wrote services/legacy/api/service.json",
      "",
      "Wrote 1 service.json file(s).",
      "",
    ].join("\n");
    const coverage = importCoverageSummary(clean, { dir: "." });
    expect(coverage).toEqual({ dropped: [], approximated: [], byDesign: [] });
    expect(formatCoverageBlock(coverage)).toBe("");
  });

  it("leaves informational lines out of the summary", () => {
    const plan = [
      "  api  (service)",
      "    note:      env reads DB_PASSWORD from the project .env; add them there",
      "    note:      healthCheck: false: Compose turns the healthcheck off",
      "    note:      published on 127.0.0.1 only: 127.0.0.1:8080->80/tcp",
      "",
      "Skipped / not fully imported:",
      "  docker-compose.yml [compose]: uses YAML anchors/aliases; values were read after resolution",
    ].join("\n");
    const coverage = importCoverageSummary(plan, {});
    expect(coverage).toEqual({ dropped: [], approximated: [], byDesign: [] });
  });

  it("reads custom networks from list and map forms, ignoring the default network", () => {
    const compose = [
      "services:",
      "  web:",
      "    networks:",
      "      frontend:",
      "        aliases: [site]",
      "      backend:",
      "  db:",
      "    networks: [data, private]",
      "networks:",
      "  frontend:",
      "  backend:",
      "  default:",
      "    driver: bridge",
    ].join("\n");
    expect(customNetworkNames(compose)).toEqual(["backend", "data", "frontend", "private"]);
    expect(customNetworkNames("services:\n  web:\n    image: nginx\n")).toEqual([]);
    expect(customNetworkNames("networks:\n  default:\n    driver: bridge\n")).toEqual([]);
  });
});

describe("runImport prints the summary", () => {
  const runThroughImport = async (
    dir: string,
    stdout: string,
  ): Promise<{ code: number; teed: string; logged: string }> => {
    const { spawnFn } = fakeSpawn({ code: 0, stdout });
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runImport([dir, "--yes"], spawnFn, () => "1.4.11");
      const teed = write.mock.calls.map((call) => String(call[0])).join("");
      const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
      return { code, teed, logged };
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
  };

  it("passes the importer's output through and appends the summary block", async () => {
    await withComposeDir("docker-compose.yaml", LYCHEE_COMPOSE, async (dir) => {
      const { code, teed, logged } = await runThroughImport(dir, LYCHEE_PLAN);
      expect(code).toBe(0);
      expect(teed).toBe(LYCHEE_PLAN);
      expect(logged).toContain("Some Compose features did not translate exactly:");
      expect(logged).toContain("docs/project/ADOPTER-COVERAGE.md#cov-container-name");
      expect(logged).toContain("docs/project/ADOPTER-COVERAGE.md#cov-networks");
      expect(logged).toContain("docs/project/ADOPTER-COVERAGE.md#cov-no-restart");
    });
  });

  it("prints nothing extra when nothing was dropped, ignored or approximated", async () => {
    await withComposeDir("docker-compose.yml", "services:\n  api:\n    build: .\n", async (dir) => {
      const clean = "Plan\n  wrote services/x/api/service.json\nWrote 1 service.json file(s).\n";
      const { code, teed, logged } = await runThroughImport(dir, clean);
      expect(code).toBe(0);
      expect(teed).toBe(clean);
      expect(logged).toBe("");
    });
  });
});

describe("flisk import --json reports the summary", () => {
  it("adds the coverage summary to the envelope data", async () => {
    await withComposeDir("docker-compose.yaml", LYCHEE_COMPOSE, async (dir) => {
      const { spawnFn } = fakeSpawn({ code: 0, stdout: LYCHEE_PLAN });
      mocks.spawn.mockImplementation(spawnFn);
      const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await executeImport([dir], { json: true });
        const envelope = JSON.parse(write.mock.calls.map((call) => String(call[0])).join("")) as {
          data: {
            dir: string;
            coverage?: {
              dropped: { label: string; anchor: string }[];
              approximated: { label: string; anchor: string }[];
              byDesign: { label: string; anchor: string }[];
            };
          };
        };
        expect(envelope.data.dir).toBe(dir);
        expect(envelope.data.coverage?.dropped.map((f) => f.anchor)).toEqual([
          "cov-container-name",
          "cov-deploy-resources-reservations",
          "cov-container-name",
        ]);
        expect(envelope.data.coverage?.approximated[0]).toEqual({
          label: 'custom networks "lychee" run as the default Flisk network',
          anchor: "cov-networks",
        });
        expect(envelope.data.coverage?.byDesign.map((f) => f.anchor)).toEqual(["cov-no-restart"]);
      } finally {
        write.mockRestore();
        err.mockRestore();
        mocks.spawn.mockReset();
      }
    });
  });
});
