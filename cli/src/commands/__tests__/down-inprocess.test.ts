// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// In-process cases for `flisk down`: a project of `command` services stops its local processes (no Tilt), the Tilt
// path's focus targets, `tilt up` stop and verbose line, the Compose fallback that cannot run, and the Docker build
// cache prune prompt. Discovery, Docker, Tilt and the native runtime are doubles, so each case states what it sees.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnvelope, runCommandInProcess } from "../../test-support/index.js";
import type { DiscoveredResource } from "../../types/index.js";

const paths = vi.hoisted(() => ({ findProjectRoot: vi.fn<(from?: string) => string | null>() }));
const docker = vi.hoisted(() => ({
  getContainerRuntimeStatus: vi.fn(() => "running"),
  dockerProbeFailedWithAccessError: vi.fn(() => false),
}));
const tilt = vi.hoisted(() => ({
  getTiltfilePath: vi.fn(() => "/project/.flisk/.flisk-out/Tiltfile"),
  isTiltAvailable: vi.fn(async () => true),
  runTilt: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
}));
const cleanup = vi.hoisted(() => ({
  lookupProjectTiltUpPids: vi.fn((): number[] | null => []),
  projectComposeProjects: vi.fn((): string[] => []),
  probeProjectIdle: vi.fn(
    async (): Promise<{ idle: boolean; networkNames?: string[] }> => ({
      idle: false,
    }),
  ),
  findRunningFliskProjects: vi.fn(async (): Promise<string[]> => []),
  pruneProjectNetworks: vi.fn(),
  stopProjectComposeProjects: vi.fn(),
  stopProjectTiltUp: vi.fn((): number[] => []),
  waitForTiltUpExit: vi.fn(async () => true),
}));
const cache = vi.hoisted(() => ({ pruneDockerBuildCache: vi.fn() }));
const prompt = vi.hoisted(() => ({ promptConfirm: vi.fn<() => Promise<boolean>>() }));
const native = vi.hoisted(() => ({
  readNativeRunState: vi.fn((): unknown => null),
  stopNativeRun: vi.fn(),
}));
const nativeService = vi.hoisted(() => ({ isNativeProject: vi.fn(() => false) }));
const inferred = vi.hoisted(() => ({
  inferNodeProject: vi.fn((): unknown => null),
  inferredStateRoot: vi.fn((dir: string) => join(dir, ".flisk", "inferred")),
}));
const services = vi.hoisted(() => ({
  discoverResources: vi.fn((): DiscoveredResource[] => []),
  discoverResourcesFromRoot: vi.fn((): DiscoveredResource[] => []),
  discoverStacks: vi.fn((): Array<{ name: string }> => []),
}));
const json = vi.hoisted(() => ({ emitted: [] as unknown[] }));

vi.mock("../../utils/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/paths.js")>()),
  ...paths,
}));
vi.mock("../../utils/docker.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/docker.js")>()),
  ...docker,
}));
vi.mock("../../utils/tilt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/tilt.js")>()),
  ...tilt,
}));
vi.mock("../../utils/down-cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/down-cleanup.js")>()),
  ...cleanup,
}));
// The watcher scan reads `ps`; the tests' fake roots must never match the machine's table.
const watchers = vi.hoisted(() => ({
  findProjectComposeEventsWatchers: vi.fn((): Array<{ pid: number }> => []),
  stopComposeEventsWatchers: vi.fn((): number[] => []),
}));
vi.mock("../../utils/compose-events-watchers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/compose-events-watchers.js")>()),
  ...watchers,
}));
vi.mock("../../utils/docker-build-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/docker-build-cache.js")>()),
  ...cache,
}));
vi.mock("../../utils/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/prompt.js")>()),
  ...prompt,
}));
vi.mock("../../utils/native-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/native-runtime.js")>()),
  ...native,
}));
vi.mock("../../utils/native-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/native-service.js")>()),
  ...nativeService,
}));
vi.mock("../../utils/inferred-node-project.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/inferred-node-project.js")>()),
  ...inferred,
}));
vi.mock("../../utils/services.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/services.js")>()),
  ...services,
}));
// The real emitter writes with writeSync(1) and listens for `exit`; record the one object instead.
vi.mock("../../utils/json-output.js", () => ({
  createJsonEmitter: () => (data: unknown) => void json.emitted.push(data),
}));

import { downCommand } from "../down.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes from captured output.
const ANSI = /\u001b\[[0-9;]*m/g;

let root: string;
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

/** Commander keeps option values on the command object between parses, so put every option back to its default. */
function resetOptions(command: Command): void {
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), option.defaultValue);
  }
}

async function runDown(args: string[]) {
  resetOptions(downCommand);
  const run = await runCommandInProcess(downCommand, args, root);
  return {
    ...run,
    stdout: run.stdout.replace(ANSI, ""),
    stderr: run.stderr.replace(ANSI, ""),
  };
}

describe("flisk down (in-process)", () => {
  beforeEach(() => {
    process.exitCode = 0;
    json.emitted = [];
    root = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-inprocess-")));
    paths.findProjectRoot.mockReturnValue(root);
    docker.getContainerRuntimeStatus.mockReturnValue("running");
    docker.dockerProbeFailedWithAccessError.mockReturnValue(false);
    tilt.getTiltfilePath.mockReturnValue(join(root, ".flisk/.flisk-out/Tiltfile"));
    tilt.isTiltAvailable.mockResolvedValue(true);
    tilt.runTilt.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    cleanup.findRunningFliskProjects.mockResolvedValue([]);
    cleanup.lookupProjectTiltUpPids.mockReturnValue([]);
    // Something runs by default, so `down` reaches `tilt down`; the idle cases say otherwise.
    cleanup.projectComposeProjects.mockReturnValue(["demo-traefik"]);
    cleanup.probeProjectIdle.mockResolvedValue({ idle: false });
    cleanup.stopProjectTiltUp.mockReturnValue([]);
    cleanup.waitForTiltUpExit.mockResolvedValue(true);
    native.readNativeRunState.mockReturnValue(null);
    nativeService.isNativeProject.mockReturnValue(false);
    inferred.inferNodeProject.mockReturnValue(null);
    services.discoverResources.mockReturnValue([]);
    services.discoverResourcesFromRoot.mockReturnValue([]);
    services.discoverStacks.mockReturnValue([]);
    setStdinTty(false);
  });
  afterEach(() => {
    vi.resetAllMocks();
    if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    rmSync(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  describe("a Docker project with nothing running (#3768)", () => {
    beforeEach(() => {
      cleanup.projectComposeProjects.mockReturnValue([]);
      cleanup.probeProjectIdle.mockResolvedValue({ idle: true });
    });

    it("asks Docker for containers exactly once and skips the docker ps liveness check (#4173)", async () => {
      await runDown([]);

      expect(cleanup.probeProjectIdle).toHaveBeenCalledTimes(1);
      expect(cleanup.probeProjectIdle).toHaveBeenCalledWith(
        root,
        join(root, ".flisk/.flisk-out/Tiltfile"),
        { listNetworks: true },
      );
      expect(docker.getContainerRuntimeStatus).not.toHaveBeenCalled();
    });

    it("says so and never loads the Tiltfile with tilt down", async () => {
      const run = await runDown([]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Nothing is running for this project.");
      expect(tilt.runTilt).not.toHaveBeenCalled();
      expect(cleanup.stopProjectTiltUp).not.toHaveBeenCalled();
    });

    it("--json reports the idle project", async () => {
      await runDown(["--json"]);

      expect(json.emitted).toEqual([
        { ok: true, stoppedTilt: [], idle: true, stoppedEventWatchers: [] },
      ]);
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("removes the networks an earlier down left, and keeps them with --no-prune-networks (#3650)", async () => {
      mkdirSync(join(root, ".flisk"), { recursive: true });
      writeFileSync(
        join(root, ".flisk", "project.json"),
        JSON.stringify({
          version: "1.0.0",
          project: { name: "demo", version: "1.0.0" },
          phases: Object.fromEntries(
            ["pre_alpha", "alpha", "beta", "out_of_scope"].map((name) => [
              name,
              { name, description: "", enabledStacks: [] },
            ]),
          ),
          optional_infra: {
            monitoring: false,
            elk: false,
            debezium: false,
            golden_image: false,
            verdaccio: false,
          },
          discovery: { paths: ["services/**"] },
        }),
      );
      cleanup.pruneProjectNetworks.mockReturnValue({ removed: ["demo_backend"], kept: [] });

      await runDown(["--json"]);
      expect(cleanup.pruneProjectNetworks).toHaveBeenCalledTimes(1);
      expect(json.emitted).toEqual([
        {
          ok: true,
          stoppedTilt: [],
          idle: true,
          stoppedEventWatchers: [],
          removedNetworks: ["demo_backend"],
          keptNetworks: [],
        },
      ]);

      cleanup.pruneProjectNetworks.mockClear();
      await runDown(["--json", "--no-prune-networks"]);
      expect(cleanup.pruneProjectNetworks).not.toHaveBeenCalled();
    });

    it("still runs tilt down when a container of the project exists", async () => {
      cleanup.projectComposeProjects.mockReturnValue(["demo-traefik"]);
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      await runDown([]);

      expect(tilt.runTilt).toHaveBeenCalledTimes(1);
    });

    it("still runs tilt down when a tilt up of the project is alive", async () => {
      cleanup.lookupProjectTiltUpPids.mockReturnValue([777]);
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      await runDown([]);

      expect(tilt.runTilt).toHaveBeenCalledTimes(1);
    });

    it("runs tilt down when the process list cannot be read, as a tilt up may be alive", async () => {
      cleanup.lookupProjectTiltUpPids.mockReturnValue(null);
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      await runDown([]);

      expect(tilt.runTilt).toHaveBeenCalledTimes(1);
    });

    it("runs tilt down when Docker cannot be asked", async () => {
      cleanup.projectComposeProjects.mockImplementation(() => {
        throw new Error("Cannot connect to the Docker daemon");
      });
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      await runDown([]);

      expect(tilt.runTilt).toHaveBeenCalledTimes(1);
    });

    it("exits 0 when Docker is off and nothing is running (#5029)", async () => {
      docker.getContainerRuntimeStatus.mockReturnValue("missing");
      // A Docker that is off cannot answer the idle probe, so the probe reports "not idle".
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      const run = await runDown([]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Nothing is running for this project.");
      expect(run.stderr).not.toContain("Flisk can't start");
      expect(tilt.runTilt).not.toHaveBeenCalled();
      expect(tilt.isTiltAvailable).not.toHaveBeenCalled();
    });

    it("--json reports stopped: [] when Docker is off and nothing is running (#5029)", async () => {
      docker.getContainerRuntimeStatus.mockReturnValue("missing");
      // A Docker that is off cannot answer the idle probe, so the probe reports "not idle".
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });

      const run = await runDown(["--json"]);

      expect(run.status).toBeUndefined();
      expect(json.emitted).toEqual([{ ok: true, stopped: [] }]);
      expect(run.stdout).not.toContain("Nothing is running");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("still asks for Docker when a tilt up may be alive and Docker is off (#5029)", async () => {
      docker.getContainerRuntimeStatus.mockReturnValue("missing");
      // A Docker that is off cannot answer the idle probe, so the probe reports "not idle".
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });
      cleanup.lookupProjectTiltUpPids.mockReturnValue([4242]);

      const run = await runDown([]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("Flisk can't start");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("still asks for Docker when the probe failed on permissions, not on a missing daemon (#5029)", async () => {
      docker.getContainerRuntimeStatus.mockReturnValue("missing");
      // A Docker that is off cannot answer the idle probe, so the probe reports "not idle".
      cleanup.probeProjectIdle.mockResolvedValue({ idle: false });
      docker.dockerProbeFailedWithAccessError.mockReturnValue(true);

      const run = await runDown([]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("Flisk can't start");
      expect(run.stdout).not.toContain("Nothing is running for this project.");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("--purge skips tilt down but still purges", async () => {
      const run = await runDown(["--purge"]);

      expect(tilt.runTilt).not.toHaveBeenCalled();
      expect(cleanup.stopProjectTiltUp).not.toHaveBeenCalled();
      expect(run.stdout).not.toContain("Nothing is running for this project.");
      expect(run.stdout).toMatch(
        /No volumes, networks or images|Removed|Could not read the project name/,
      );
    });
  });

  it("--json rejects an invalid --cache-until with a machine error and exit 1", async () => {
    const run = await runDown(["--json", "--prune-cache", "--cache-until", "soon"]);
    const envelope = parseEnvelope(run.stdout);

    expect(run.status).toBe(1);
    expect(envelope.data).toBeNull();
    expect(envelope.errors[0]?.message).toBe('Invalid --cache-until format: "soon"');
    expect(tilt.runTilt).not.toHaveBeenCalled();
  });

  describe("a project of command services", () => {
    it("--json --dry-run reports the native runtime, the services it would stop and the cache prune it would run", async () => {
      native.readNativeRunState.mockReturnValue({ pid: 4242, services: { api: {} } });

      const run = await runDown(["--json", "--dry-run", "--prune-cache", "48h"]);

      expect(run.status).toBeUndefined();
      expect(json.emitted).toEqual([
        {
          ok: true,
          dryRun: true,
          runtime: "native",
          wouldStop: ["api"],
          wouldPruneCache: { until: "48h" },
        },
      ]);
      expect(native.stopNativeRun).not.toHaveBeenCalled();
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("--dry-run names the local processes it would stop, and stops nothing", async () => {
      native.readNativeRunState.mockReturnValue({
        pid: 4242,
        services: { "shop-demo-web": { pid: 11 }, "shop-demo-api": { pid: 12 } },
      });

      const run = await runDown(["--dry-run"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Dry run - not stopping local processes");
      expect(run.stdout).toContain("Would stop: shop-demo-web, shop-demo-api");
      expect(run.stdout).not.toContain("Would run: stop the local processes of this project");
      expect(native.stopNativeRun).not.toHaveBeenCalled();
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("--json --dry-run lists every service of the recorded run", async () => {
      native.readNativeRunState.mockReturnValue({
        pid: 4242,
        services: { "shop-demo-web": { pid: 11 }, "shop-demo-api": { pid: 12 } },
      });

      const run = await runDown(["--json", "--dry-run"]);

      expect(run.status).toBeUndefined();
      expect(json.emitted).toEqual([
        {
          ok: true,
          dryRun: true,
          runtime: "native",
          wouldStop: ["shop-demo-web", "shop-demo-api"],
        },
      ]);
      expect(native.stopNativeRun).not.toHaveBeenCalled();
    });

    it("--dry-run says nothing is running when no run is on record", async () => {
      nativeService.isNativeProject.mockReturnValue(true);

      const run = await runDown(["--dry-run"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Dry run - not stopping local processes");
      expect(run.stdout).toContain("Nothing is running for this project.");
      expect(run.stdout).not.toContain("Would run: stop the local processes of this project");
      expect(native.stopNativeRun).not.toHaveBeenCalled();
    });

    it("--json --dry-run reports an empty wouldStop when no run is on record", async () => {
      nativeService.isNativeProject.mockReturnValue(true);

      const run = await runDown(["--json", "--dry-run"]);

      expect(run.status).toBeUndefined();
      expect(json.emitted).toEqual([{ ok: true, dryRun: true, runtime: "native", wouldStop: [] }]);
      expect(native.stopNativeRun).not.toHaveBeenCalled();
    });

    it("--dry-run prints the local-process plan and the cache prune it would run", async () => {
      nativeService.isNativeProject.mockReturnValue(true);

      const run = await runDown(["--dry-run", "--prune-cache", "--cache-until", "2h"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Dry run - not stopping local processes");
      expect(run.stdout).toContain(
        "Dry run - not pruning Docker build cache (would run: docker builder prune -f --filter until=2h)",
      );
      expect(native.stopNativeRun).not.toHaveBeenCalled();
    });

    it("stops the local processes and names them", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({ wasRunning: true, services: ["api", "web"] });

      const run = await runDown([]);

      expect(run.status).toBeUndefined();
      expect(native.stopNativeRun).toHaveBeenCalledWith(root);
      expect(run.stdout).toContain("Stopped local processes: api, web");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("says nothing is running when no local run is on record", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({ wasRunning: false, services: [] });

      const run = await runDown([]);

      expect(run.stdout).toContain("Nothing is running for this project.");
    });

    it("says the run record was stale and signals nothing when its pids are not Flisk's (#3960)", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({ wasRunning: false, stale: true, services: [] });

      const run = await runDown([]);

      expect(run.stdout).toContain("Stale run record, nothing to stop");
      expect(run.stdout).not.toContain("Stopped local processes");
    });

    it("names live processes it could not prove it started, with their pids (#3960)", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({
        wasRunning: true,
        services: ["api"],
        unverified: [{ name: "api", pid: 4242 }],
      });

      const run = await runDown([]);

      expect(run.stdout).toContain("api (pid 4242)");
      expect(run.stdout).toContain("not stopped");
    });

    it("--json reports the stopped services in one envelope", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({ wasRunning: true, services: ["api"] });

      const run = await runDown(["--json"]);

      expect(run.stdout).toBe("");
      expect(json.emitted).toEqual([
        { ok: true, runtime: "native", stopped: ["api"], stoppedEventWatchers: [] },
      ]);
    });

    it("ends compose event watchers a converted project left behind (#4854)", async () => {
      // The stack ran on Tilt before `command` services replaced it; its event streams still run.
      nativeService.isNativeProject.mockReturnValue(true);
      native.stopNativeRun.mockResolvedValue({ wasRunning: true, services: ["api"] });
      mkdirSync(join(root, ".flisk"), { recursive: true });
      writeFileSync(
        join(root, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "shop" } }),
      );
      const leftover = [
        {
          pid: 41,
          command: "docker compose --project-name shop-app-autogenerated events --json",
          projectName: "shop-app-autogenerated",
          projectDir: `${root}/services/app/.autogenerated`,
        },
      ];
      watchers.findProjectComposeEventsWatchers.mockReturnValue(leftover);
      watchers.stopComposeEventsWatchers.mockReturnValue([41]);

      const run = await runDown([]);

      expect(watchers.findProjectComposeEventsWatchers).toHaveBeenCalledWith(root, "shop");
      expect(watchers.stopComposeEventsWatchers).toHaveBeenCalledWith(leftover);
      expect(run.stdout).toContain(
        'Stopped 1 "docker compose events" watcher process(es) (pid 41)',
      );
    });

    it("a dry run names the compose event watchers a real stop would end, without stopping them (#4854)", async () => {
      nativeService.isNativeProject.mockReturnValue(true);
      mkdirSync(join(root, ".flisk"), { recursive: true });
      writeFileSync(
        join(root, ".flisk", "project.json"),
        JSON.stringify({ project: { name: "shop" } }),
      );
      watchers.findProjectComposeEventsWatchers.mockReturnValue([{ pid: 41 }, { pid: 42 }]);

      const run = await runDown(["--dry-run"]);
      expect(run.stdout).toContain(
        'would stop 2 "docker compose events" watcher process(es) (pid 41, 42)',
      );

      await runDown(["--json", "--dry-run"]);
      expect(json.emitted).toEqual([
        {
          ok: true,
          dryRun: true,
          runtime: "native",
          wouldStop: [],
          wouldStopComposeWatchers: [41, 42],
        },
      ]);
      expect(watchers.stopComposeEventsWatchers).not.toHaveBeenCalled();
      expect(native.stopNativeRun).not.toHaveBeenCalled();
    });

    describe("--purge/--prune-networks name the flag that does not apply (#3697)", () => {
      beforeEach(() => {
        nativeService.isNativeProject.mockReturnValue(true);
      });

      it("--purge --dry-run prints the note that nothing was removed from Docker", async () => {
        const run = await runDown(["--dry-run", "--purge"]);

        expect(run.status).toBeUndefined();
        expect(run.stdout).toContain("Dry run - not stopping local processes");
        expect(run.stdout).toContain(
          "--purge only applies to Docker/Tilt projects; nothing was removed from Docker.",
        );
        expect(native.stopNativeRun).not.toHaveBeenCalled();
      });

      it("--prune-networks --dry-run names that flag in the note", async () => {
        const run = await runDown(["--dry-run", "--prune-networks"]);

        expect(run.stdout).toContain(
          "--prune-networks only applies to Docker/Tilt projects; nothing was removed from Docker.",
        );
      });

      it("names both flags when --purge and --prune-networks are given", async () => {
        const run = await runDown(["--dry-run", "--purge", "--prune-networks"]);

        expect(run.stdout).toContain(
          "--purge and --prune-networks only apply to Docker/Tilt projects; nothing was removed from Docker.",
        );
      });

      it("--json --dry-run carries the note in warnings", async () => {
        await runDown(["--json", "--dry-run", "--purge"]);

        expect(json.emitted).toEqual([
          {
            ok: true,
            dryRun: true,
            runtime: "native",
            wouldStop: [],
            warnings: [
              "--purge only applies to Docker/Tilt projects; nothing was removed from Docker.",
            ],
          },
        ]);
      });

      it("a real stop prints the note after naming the stopped services", async () => {
        native.stopNativeRun.mockResolvedValue({ wasRunning: true, services: ["api"] });

        const run = await runDown(["--purge"]);

        expect(native.stopNativeRun).toHaveBeenCalledWith(root);
        expect(run.stdout).toContain("Stopped local processes: api");
        expect(run.stdout).toContain(
          "--purge only applies to Docker/Tilt projects; nothing was removed from Docker.",
        );
      });

      it("a real stop with --json carries the note in warnings", async () => {
        native.stopNativeRun.mockResolvedValue({ wasRunning: true, services: ["api"] });

        await runDown(["--json", "--prune-networks"]);

        expect(json.emitted).toEqual([
          {
            ok: true,
            runtime: "native",
            stopped: ["api"],
            stoppedEventWatchers: [],
            warnings: [
              "--prune-networks only applies to Docker/Tilt projects; nothing was removed from Docker.",
            ],
          },
        ]);
      });

      it("--no-prune-networks asks for no Docker cleanup, so no note and no warnings", async () => {
        const run = await runDown(["--dry-run", "--no-prune-networks"]);

        expect(run.stdout).not.toContain("Docker/Tilt projects");

        await runDown(["--json", "--dry-run", "--no-prune-networks"]);
        expect(json.emitted).toEqual([
          { ok: true, dryRun: true, runtime: "native", wouldStop: [] },
        ]);
      });

      it("an inferred plain Node folder gets the same note", async () => {
        inferred.inferNodeProject.mockReturnValue({
          kind: "service",
          service: "plain-node",
          command: "bun run dev",
          script: "dev",
        });
        native.stopNativeRun.mockResolvedValue({ wasRunning: false, services: [] });

        const run = await runDown(["--purge"]);

        expect(run.stdout).toContain(
          "--purge only applies to Docker/Tilt projects; nothing was removed from Docker.",
        );
        expect(native.stopNativeRun).toHaveBeenCalledWith(join(root, ".flisk", "inferred"));
      });
    });
  });

  it("uses Tilt when discovery throws, and prints the dry-run cache prune it would run", async () => {
    services.discoverResourcesFromRoot.mockImplementation(() => {
      throw new Error("bad manifest");
    });

    const run = await runDown(["--dry-run", "--prune-cache"]);

    expect(run.status).toBeUndefined();
    expect(run.stdout).toContain("Dry run - not stopping resources");
    expect(run.stdout).toContain("Would run: tilt down");
    expect(run.stdout).toContain("--filter until=24h)");
    expect(native.stopNativeRun).not.toHaveBeenCalled();
    expect(tilt.runTilt).not.toHaveBeenCalled();
  });

  it("focuses tilt down on every stack, stops tilt up first, and prints the verbose command", async () => {
    services.discoverStacks.mockReturnValue([{ name: "shop" }, { name: "ops" }]);
    cleanup.stopProjectTiltUp.mockReturnValue([1234, 5678]);

    const run = await runDown(["--verbose"]);

    expect(run.status).toBeUndefined();
    expect(cleanup.stopProjectTiltUp).toHaveBeenCalledWith(
      join(root, ".flisk/.flisk-out/Tiltfile"),
    );
    expect(cleanup.waitForTiltUpExit).toHaveBeenCalledWith(
      join(root, ".flisk/.flisk-out/Tiltfile"),
    );
    expect(run.stdout).toContain("Stopped tilt up (pid 1234, 5678).");
    expect(run.stdout).toContain("Running: tilt down -f .flisk/.flisk-out/Tiltfile");
    const [subcommand, args, options] = tilt.runTilt.mock.calls[0] as unknown as [
      string,
      string[],
      { verbose: boolean; inheritStdio: boolean },
    ];
    expect(subcommand).toBe("down");
    expect(args.slice(-2)).toEqual(["--", "--focus=shop,ops"]);
    expect(options).toEqual({ verbose: true, inheritStdio: true });
  });

  it("runs tilt down without a focus when stacks cannot be listed", async () => {
    services.discoverResources.mockImplementation(() => {
      throw new Error("bad manifest");
    });

    const run = await runDown(["--json"]);

    expect(run.status).toBeUndefined();
    const args = (tilt.runTilt.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args.join(" ")).not.toContain("--focus");
    expect(json.emitted).toEqual([{ ok: true, stoppedTilt: [], stoppedEventWatchers: [] }]);
  });

  it("fails with tilt down's exit code when the Compose fallback itself throws", async () => {
    tilt.runTilt.mockResolvedValue({ exitCode: 3, stdout: "", stderr: "Tiltfile error" });
    cleanup.stopProjectComposeProjects.mockImplementation(() => {
      throw new Error("docker unavailable");
    });

    const run = await runDown([]);

    expect(run.status).toBe(3);
    expect(cleanup.stopProjectComposeProjects).toHaveBeenCalledWith(root);
    expect(run.stderr).toContain("tilt down failed with exit code 3");
  });

  it("--prune-networks skips network pruning when the project root is gone by then", async () => {
    // Every lookup before tilt down finds the root; the network prune after it finds none.
    let isRootGone = false;
    paths.findProjectRoot.mockImplementation(() => (isRootGone ? null : root));
    tilt.runTilt.mockImplementation(async () => {
      isRootGone = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const run = await runDown(["--json", "--prune-networks"]);

    expect(run.status).toBeUndefined();
    expect(cleanup.pruneProjectNetworks).not.toHaveBeenCalled();
    expect(json.emitted).toEqual([{ ok: true, stoppedTilt: [], stoppedEventWatchers: [] }]);
  });

  describe("--prune-cache", () => {
    it.each([
      ["7d", "168h"],
      ["24H", "24h"],
      ["1d12h", "36h"],
    ])("dry-run shows the normalized %s filter before any stop", async (input, expected) => {
      const run = await runDown(["--json", "--dry-run", "--prune-cache", input]);
      expect(run.status).toBeUndefined();
      expect(json.emitted).toEqual([
        { ok: true, dryRun: true, wouldPruneCache: { until: expected } },
      ]);
      expect(tilt.runTilt).not.toHaveBeenCalled();
      expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
    });

    it("without --yes outside a terminal skips the prune and says why", async () => {
      const run = await runDown(["--prune-cache"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain(
        "Skipping Docker build cache prune: confirmation required; run in a terminal or pass --yes.",
      );
      expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
      expect(prompt.promptConfirm).not.toHaveBeenCalled();
    });

    it("in a terminal warns that the cache is shared, asks, and prunes when confirmed", async () => {
      setStdinTty(true);
      prompt.promptConfirm.mockResolvedValue(true);
      cache.pruneDockerBuildCache.mockResolvedValue({ reclaimed: "1.2GB" });

      const run = await runDown(["--prune-cache", "7d"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain(
        "Notice: Docker build cache is shared across all projects on this machine.",
      );
      expect(prompt.promptConfirm).toHaveBeenCalledWith({
        message: "Prune Docker build cache older than 168h?",
        initial: false,
      });
      expect(cache.pruneDockerBuildCache).toHaveBeenCalledWith({ until: "168h" });
      expect(run.stdout).toContain(
        "Pruned Docker build cache: 1.2GB reclaimed (filter: until=168h).",
      );
    });

    it("in a terminal skips the prune when the user declines", async () => {
      setStdinTty(true);
      prompt.promptConfirm.mockResolvedValue(false);

      const run = await runDown(["--prune-cache"]);

      expect(run.stdout).toContain("Skipped Docker build cache prune.");
      expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
    });

    it("in a terminal treats a cancelled prompt as declined", async () => {
      setStdinTty(true);
      prompt.promptConfirm.mockRejectedValue(new Error("cancelled"));

      const run = await runDown(["--prune-cache"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Skipped Docker build cache prune.");
      expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
    });

    it("with --yes reports a failed prune as a warning and still succeeds", async () => {
      cache.pruneDockerBuildCache.mockRejectedValue(new Error("builder busy"));

      const run = await runDown(["--prune-cache", "--yes"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("Could not prune Docker build cache: builder busy");
    });

    it("with --yes --json records a non-Error prune failure as skipped", async () => {
      cache.pruneDockerBuildCache.mockRejectedValue("daemon gone");

      const run = await runDown(["--prune-cache", "--yes", "--json"]);

      expect(run.stdout).toBe("");
      expect(json.emitted).toEqual([
        {
          ok: true,
          stoppedTilt: [],
          stoppedEventWatchers: [],
          prunedCache: { until: "24h", skipped: true, reason: "daemon gone" },
        },
      ]);
    });
  });
});
