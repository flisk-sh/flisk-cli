// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const {
  runTiltMock,
  buildTiltDownArgsMock,
  getContainerRuntimeStatusMock,
  isTiltAvailableMock,
  pruneProjectNetworksMock,
  planProjectNetworkPruneMock,
  stopProjectTiltUpMock,
  waitForTiltUpExitMock,
  createJsonEmitterMock,
  findRunningFliskProjectsMock,
  pruneDockerBuildCacheMock,
  trimColimaAndMeasureMock,
  stopProjectComposeProjectsMock,
  lookupProjectTiltUpPidsMock,
  probeProjectIdleMock,
  projectComposeProjectsMock,
  listProjectArtifactsMock,
  removeProjectArtifactsMock,
  dropCheckoutDatabasesMock,
  foreignOwnersMock,
  findComposeWatchersMock,
  stopComposeWatchersMock,
} = vi.hoisted(() => ({
  foreignOwnersMock: vi.fn(() => [] as { root: string; containers: string[] }[]) as Mock,
  findComposeWatchersMock: vi.fn(
    (): { pid: number; command: string; projectName?: string; projectDir?: string }[] => [],
  ) as Mock,
  stopComposeWatchersMock: vi.fn((): number[] => []) as Mock,
  listProjectArtifactsMock: vi.fn() as Mock,
  removeProjectArtifactsMock: vi.fn() as Mock,
  dropCheckoutDatabasesMock: vi.fn(() => ({
    suffix: "",
    dropped: ["test_project_api"],
    kept: [],
  })) as Mock,
  runTiltMock: vi.fn() as Mock,
  buildTiltDownArgsMock: vi.fn() as Mock,
  getContainerRuntimeStatusMock: vi.fn(
    () => "missing" as "running" | "unresponsive" | "missing",
  ) as Mock,
  isTiltAvailableMock: vi.fn(async () => false) as Mock,
  pruneProjectNetworksMock: vi.fn() as Mock,
  planProjectNetworkPruneMock: vi.fn() as Mock,
  stopProjectTiltUpMock: vi.fn(() => [] as number[]) as Mock,
  waitForTiltUpExitMock: vi.fn(async () => true) as Mock,
  createJsonEmitterMock: vi.fn() as Mock,
  findRunningFliskProjectsMock: vi.fn(async (): Promise<string[]> => []) as Mock,
  pruneDockerBuildCacheMock: vi.fn() as Mock,
  trimColimaAndMeasureMock: vi.fn(async (): Promise<unknown> => null) as Mock,
  stopProjectComposeProjectsMock: vi.fn() as Mock,
  lookupProjectTiltUpPidsMock: vi.fn((): number[] => []) as Mock,
  probeProjectIdleMock: vi.fn(
    async (): Promise<{ idle: boolean; networkNames?: string[] }> => ({
      idle: false,
    }),
  ) as Mock,
  // Something runs by default, so `down` reaches `tilt down`; the idle cases say otherwise.
  projectComposeProjectsMock: vi.fn((): string[] => ["demo-traefik"]) as Mock,
}));
const originalCwd = process.cwd();

vi.mock("../../utils/docker.js", () => ({
  getContainerRuntimeStatus: getContainerRuntimeStatusMock,
}));

// The real trim asks the Colima of the machine running the tests and would run fstrim in its VM.
vi.mock("../../utils/colima-disk.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/colima-disk.js")>()),
  trimColimaAndMeasure: trimColimaAndMeasureMock,
}));

vi.mock("../../utils/docker-build-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/docker-build-cache.js")>()),
  pruneDockerBuildCache: pruneDockerBuildCacheMock,
}));

// The real lookup reads `ps`, and a stack running on the test machine must never be picked (or stopped) by a test.
vi.mock("../../utils/down-cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/down-cleanup.js")>()),
  lookupProjectTiltUpPids: lookupProjectTiltUpPidsMock,
  probeProjectIdle: probeProjectIdleMock,
  findRunningFliskProjects: findRunningFliskProjectsMock,
  projectComposeProjects: projectComposeProjectsMock,
  pruneProjectNetworks: pruneProjectNetworksMock,
  planProjectNetworkPrune: planProjectNetworkPruneMock,
  stopProjectComposeProjects: stopProjectComposeProjectsMock,
  stopProjectTiltUp: stopProjectTiltUpMock,
  waitForTiltUpExit: waitForTiltUpExitMock,
}));

// --purge drops this checkout's logical databases and removes Docker objects; the tests never touch a real daemon.
vi.mock("../../utils/checkout-database-purge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/checkout-database-purge.js")>()),
  dropCheckoutDatabases: dropCheckoutDatabasesMock,
}));

vi.mock("../../utils/project-purge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/project-purge.js")>()),
  listProjectArtifacts: listProjectArtifactsMock,
  removeProjectArtifacts: removeProjectArtifactsMock,
}));

// `down` reports what the project still holds; the tests give it fixed numbers instead of asking Docker.
const collectLeftoversMock: Mock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/down-leftovers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/down-leftovers.js")>()),
  collectLeftovers: collectLeftoversMock,
}));

// The real lookup scans `ps` for compose event watchers; the tests decide which exist, never the machine's table.
vi.mock("../../utils/compose-events-watchers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/compose-events-watchers.js")>()),
  findProjectComposeEventsWatchers: findComposeWatchersMock,
  stopComposeEventsWatchers: stopComposeWatchersMock,
}));

// `--purge` asks Docker which other folders own containers of this project name (#3961); the tests give the answer.
vi.mock("../../utils/project-owner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/project-owner.js")>()),
  findForeignContainerOwners: foreignOwnersMock,
}));

vi.mock("../../utils/project-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/project-registry.js")>()),
  readProjectRecords: () => [
    { name: "test-project", roots: ["/here"], stacks: ["retired"], updatedAt: "" },
    { name: "test-project-admin", roots: ["/gone"], stacks: [], updatedAt: "" },
  ],
}));

vi.mock("../../utils/tilt.js", () => ({
  buildTiltDownArgs: buildTiltDownArgsMock,
  getTiltfilePath: vi.fn(),
  isTiltAvailable: isTiltAvailableMock,
  runTilt: runTiltMock,
}));

vi.mock("../../utils/json-output.js", () => ({
  createJsonEmitter: createJsonEmitterMock,
}));

const promptConfirmMock: Mock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../utils/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/prompt.js")>()),
  promptConfirm: promptConfirmMock,
}));

import {
  ALL_OPTIONAL_INFRA_DISABLED,
  BASE_PHASES,
  SERVICES_DISCOVERY_PATHS,
} from "../../test-support/project-config.js";
import { FliskError } from "../../utils/errors.js";
import { buildTiltDownArgs } from "../../utils/tilt.js";
import { downCommand } from "../down.js";

const VALID_PROJECT_CONFIG = {
  version: "1.0.0",
  project: { name: "test-project", version: "1.0.0" },
  phases: BASE_PHASES,
  optional_infra: ALL_OPTIONAL_INFRA_DISABLED,
  discovery: { paths: SERVICES_DISCOVERY_PATHS },
};

const createdProjects: string[] = [];

function setupTestProject(): string {
  // `process.cwd()` canonicalizes symlinked temp roots (macOS resolves /var to /private/var), so use the same
  // canonical path here that production's findProjectRoot() derives.
  const tempDir = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-prune-test-")));
  mkdirSync(join(tempDir, ".flisk"), { recursive: true });
  writeFileSync(join(tempDir, ".flisk", "project.json"), JSON.stringify(VALID_PROJECT_CONFIG));
  createdProjects.push(tempDir);
  process.chdir(tempDir);
  getContainerRuntimeStatusMock.mockReturnValue("running");
  isTiltAvailableMock.mockResolvedValue(true);
  buildTiltDownArgsMock.mockReturnValue(["-f", "/fake/Tiltfile"]);
  runTiltMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  return tempDir;
}

export function downTestContext() {
  beforeEach(() => {
    getContainerRuntimeStatusMock.mockReset().mockReturnValue("missing");
    isTiltAvailableMock.mockReset().mockResolvedValue(false);
    pruneProjectNetworksMock.mockReset();
    planProjectNetworkPruneMock.mockReset();
    stopProjectTiltUpMock.mockReset().mockReturnValue([]);
    waitForTiltUpExitMock.mockReset().mockResolvedValue(true);
    createJsonEmitterMock.mockReset();
    findRunningFliskProjectsMock.mockReset().mockResolvedValue([]);
    pruneDockerBuildCacheMock.mockReset();
    trimColimaAndMeasureMock.mockReset();
    trimColimaAndMeasureMock.mockResolvedValue(null);
    stopProjectComposeProjectsMock.mockReset();
    lookupProjectTiltUpPidsMock.mockReset().mockReturnValue([]);
    probeProjectIdleMock.mockReset().mockResolvedValue({ idle: false });
    projectComposeProjectsMock.mockReset().mockReturnValue(["demo-traefik"]);
    listProjectArtifactsMock.mockReset();
    removeProjectArtifactsMock.mockReset();
    dropCheckoutDatabasesMock.mockReset().mockReturnValue({
      suffix: "",
      dropped: ["test_project_api"],
      kept: [],
    });
    foreignOwnersMock.mockReset().mockReturnValue([]);
    collectLeftoversMock.mockReset().mockResolvedValue(null);
    promptConfirmMock.mockReset().mockResolvedValue(false);
    findComposeWatchersMock.mockReset().mockReturnValue([]);
    stopComposeWatchersMock.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Projects from setupTestProject() are cleaned up here, so tests need no try/finally of their own.
    process.chdir(originalCwd);
    for (const dir of createdProjects.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    runTiltMock.mockReset();
    for (const option of [
      "dryRun",
      "json",
      "verbose",
      "force",
      "yes",
      "pruneCache",
      "cacheUntil",
      "purge",
    ]) {
      downCommand.setOptionValue(option, false);
    }
    downCommand.setOptionValue("pruneNetworks", undefined);
    downCommand.setOptionValue("project", undefined);
    downCommand.setOptionValue("cacheUntil", undefined);
    // createProgram() makes the shared downCommand a child of a root program that keeps its own --project value.
    downCommand.parent?.setOptionValue("project", undefined);
  });

  /** A scratch Flisk project folder (realpath, as process.cwd() reports it on macOS). */
  function scratchProject(name: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), `flisk-down-${name}-`)));
    mkdirSync(join(dir, ".flisk"), { recursive: true });
    writeFileSync(join(dir, ".flisk", "project.json"), "{}");
    return dir;
  }

  /** Runs `flisk down` (with Docker and Tilt available) and returns the folder it ran `tilt down` from. */
  async function downFrom(
    cwd: string,
    args: string[],
  ): Promise<{ tiltCwd?: string; output: string }> {
    getContainerRuntimeStatusMock.mockReturnValue("running");
    isTiltAvailableMock.mockResolvedValue(true);
    buildTiltDownArgsMock.mockReturnValue(["-f", "/fake/Tiltfile"]);
    let tiltCwd: string | undefined;
    runTiltMock.mockImplementation(async () => {
      tiltCwd = process.cwd();
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(cwd);
    try {
      await downCommand.parseAsync(["node", "flisk", ...args], { from: "node" });
      return { tiltCwd, output: log.mock.calls.map((call) => call.join(" ")).join("\n") };
    } finally {
      process.chdir(originalCwd);
      log.mockRestore();
    }
  }

  /** Runs `flisk down` expecting it to exit with an error, and returns what it printed to stderr. */
  async function downFails(cwd: string, args: string[]): Promise<string> {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new FliskError(`exit:${code ?? 0}`, ["Check the command's documented exit codes"]);
    }) as never);
    process.chdir(cwd);
    try {
      await expect(
        downCommand.parseAsync(["node", "flisk", ...args], { from: "node" }),
      ).rejects.toThrow("exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      return error.mock.calls.flat().join("\n");
    } finally {
      process.chdir(originalCwd);
      exit.mockRestore();
      error.mockRestore();
    }
  }

  return { scratchProject, downFrom, downFails, originalCwd };
}

export function setupDownAliasTest(prefix: string) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(tempDir, ".flisk"), { recursive: true });
  writeFileSync(join(tempDir, ".flisk", "project.json"), "{}");
  process.chdir(tempDir);
  getContainerRuntimeStatusMock.mockReturnValue("running");
  isTiltAvailableMock.mockResolvedValue(true);
  buildTiltDownArgsMock.mockReturnValue(["-f", "/fake/Tiltfile"]);
  runTiltMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return {
    tempDir,
    log,
    warn,
    cleanup() {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
      warn.mockRestore();
      log.mockRestore();
    },
  };
}

export function expectDownTiltInvocation(): void {
  expect(runTiltMock).toHaveBeenCalledWith("down", ["-f", "/fake/Tiltfile"], expect.any(Object));
}

export function expectDeprecatedForceNotice(warn: Mock): void {
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining(
      "Note: --force (-f) on flisk down is deprecated; use --yes (-y) instead.",
    ),
  );
}

export function expectDeprecatedAliasBehavior(warn: Mock): void {
  expect(downCommand.opts().yes).toBe(true);
  expectDeprecatedForceNotice(warn);
  expect(buildTiltDownArgsMock).toHaveBeenCalledWith(expect.not.objectContaining({ force: true }));
  expectDownTiltInvocation();
}

export {
  afterEach,
  beforeEach,
  buildTiltDownArgs,
  buildTiltDownArgsMock,
  collectLeftoversMock,
  createJsonEmitterMock,
  describe,
  downCommand,
  dropCheckoutDatabasesMock,
  expect,
  findComposeWatchersMock,
  findRunningFliskProjectsMock,
  foreignOwnersMock,
  getContainerRuntimeStatusMock,
  isTiltAvailableMock,
  it,
  join,
  listProjectArtifactsMock,
  lookupProjectTiltUpPidsMock,
  mkdirSync,
  mkdtempSync,
  originalCwd,
  planProjectNetworkPruneMock,
  probeProjectIdleMock,
  projectComposeProjectsMock,
  promptConfirmMock,
  pruneDockerBuildCacheMock,
  pruneProjectNetworksMock,
  realpathSync,
  removeProjectArtifactsMock,
  rmSync,
  runTiltMock,
  setupTestProject,
  stopComposeWatchersMock,
  stopProjectComposeProjectsMock,
  stopProjectTiltUpMock,
  tmpdir,
  trimColimaAndMeasureMock,
  VALID_PROJECT_CONFIG,
  vi,
  waitForTiltUpExitMock,
  writeFileSync,
};
