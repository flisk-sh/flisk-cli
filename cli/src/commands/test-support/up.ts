// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTiltfileOrchestration,
  ProjectConfigNotFoundError,
  verifyMasterConfigs,
} from "../../generator/template-engine.js";
import { captureExit, makeResource } from "../../test-support/index.js";
import {
  ALL_OPTIONAL_INFRA_DISABLED,
  BASE_PHASES,
  SERVICES_DISCOVERY_PATHS,
} from "../../test-support/project-config.js";
import { runCommandInProcess } from "../../test-support/run-in-process.js";
import { listTiltInstances } from "../../utils/doctor-wiring.js";
import { PROJECT_ENV_FILE_VAR } from "../../utils/env-selection.js";
import { FliskError, requireProjectRoot } from "../../utils/errors.js";
import { getHostPortPlan, writeSavedHostPortPlan } from "../../utils/host-port-config.js";
import { findProjectRoot } from "../../utils/paths.js";
import { findAvailablePort } from "../../utils/port-assignment.js";
import { discoverResourcesStrict } from "../../utils/services.js";
import { runTilt } from "../../utils/tilt.js";
import { findProjectTiltPorts, stopOwnedTiltOnPort } from "../../utils/tilt-port-owner.js";
import { findTiltProcessIdsOnPort, stopTiltOnPort } from "../../utils/tilt-process.js";
import {
  alreadyRunningReport,
  parseTiltPort,
  resolveTiltPort,
  secondUpAction,
  stopTiltForUp,
} from "../../utils/tilt-startup.js";
import { readFastNoopState, writeFastNoopState } from "../../utils/up-fast-noop.js";
import { tiltGetUiResources, waitForTiltResourcesReady } from "../../utils/up-readiness.js";
import type * as UpWaitModule from "../../utils/up-wait.js";
import { upAndWait } from "../../utils/up-wait.js";
import type * as UpWaitHealthModule from "../../utils/up-wait-health.js";
import { upWaitServiceHealth } from "../../utils/up-wait-health.js";
import { checkPrintedUrls } from "../../utils/url-check.js";
import {
  DRIFT_EXIT_CODE,
  driftReport,
  enforceDriftGate,
  enforceVersionFloor,
  formatUpSuccess,
  nativeWindowsUpRefusal,
  selectRunEnvFile,
  upCommand,
  waitForTiltUnlessStartupFailed,
} from "../up.js";

vi.mock("../../generator/template-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../generator/template-engine.js")>()),
  verifyMasterConfigs: vi.fn(),
  isTiltfileOrchestration: vi.fn(() => false),
}));
vi.mock("../../utils/tilt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/tilt.js")>()),
  runTilt: vi.fn(),
}));
vi.mock("../../utils/errors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/errors.js")>()),
  requireProjectRoot: vi.fn(() => "/project"),
  withTiltCheck: vi.fn(async (action: () => Promise<unknown>) => action()),
}));
vi.mock("../../utils/agent-host.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/agent-host.js")>()),
  detectHost: vi.fn(() => ({ kind: "local", canUp: true })),
}));
vi.mock("../../utils/services.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/services.js")>()),
  discoverResourcesStrict: vi.fn(() => []),
}));
vi.mock("../../utils/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/paths.js")>()),
  findProjectRoot: vi.fn(() => "/project"),
}));
vi.mock("../../utils/cold-preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/cold-preflight.js")>()),
  assertMachineReadyOrExit: vi.fn(async () => {}),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: actual, writeSync: vi.fn(actual.writeSync) };
});
vi.mock("../../utils/host-port-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/host-port-config.js")>()),
  getHostPortPlan: vi.fn(async () => ({ ports: [] })),
}));
vi.mock("../../utils/tilt-port-owner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/tilt-port-owner.js")>()),
  findProjectTiltPorts: vi.fn(async () => ({
    running: [] as number[],
    foreign: [] as unknown[],
    savedRunning: [] as number[],
    unknownSaved: [] as number[],
  })),
  stopOwnedTiltOnPort: vi.fn(() => []),
}));
// The claims live under the user's home; the tests must not write there.
vi.mock("../../utils/checkout-host-claims.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/checkout-host-claims.js")>()),
  withCheckoutHostLock: vi.fn(async (fn: () => unknown) => fn()),
  liveCheckoutHostClaims: vi.fn(() => []),
  recordCheckoutHostClaim: vi.fn(),
}));
vi.mock("../../utils/doctor-wiring.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/doctor-wiring.js")>()),
  listTiltInstances: vi.fn(() => []),
}));
vi.mock("../../utils/up-readiness.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/up-readiness.js")>();
  return {
    ...actual,
    tiltGetUiResources: vi.fn(actual.tiltGetUiResources),
    waitForTiltResourcesReady: vi.fn(actual.waitForTiltResourcesReady),
  };
});
vi.mock("../../utils/url-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/url-check.js")>();
  return { ...actual, checkPrintedUrls: vi.fn(actual.checkPrintedUrls) };
});
// Which other folders hold containers of this project name is a Docker question (#3961); the tests answer it.
const foreignOwners = vi.hoisted(() => vi.fn(() => [] as { root: string; containers: string[] }[]));
vi.mock("../../utils/project-owner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/project-owner.js")>()),
  findForeignContainerOwners: foreignOwners,
}));
vi.mock("../../utils/project-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/project-registry.js")>()),
  projectNameAt: () => "shop",
  recordProjectRoot: vi.fn(),
}));
vi.mock("../../utils/up-wait.js", async (importOriginal) => ({
  ...(await importOriginal<typeof UpWaitModule>()),
  upAndWait: vi.fn(),
  fetchUnhealthyReport: vi.fn(async () => null),
}));
vi.mock("../../utils/up-wait-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof UpWaitHealthModule>();
  return { ...actual, upWaitServiceHealth: vi.fn(async () => []) };
});
vi.mock("../../utils/port-assignment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/port-assignment.js")>();
  return { ...actual, findAvailablePort: vi.fn(actual.findAvailablePort) };
});
vi.mock("../../utils/tilt-startup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/tilt-startup.js")>();
  return {
    ...actual,
    resolveTiltPort: vi.fn(actual.resolveTiltPort),
    stopTiltForUp: vi.fn(actual.stopTiltForUp),
  };
});

/**
 * The exit code the "Exit codes" table in `CONTRIBUTING.md` lists for a diagnostic.
 *
 * The table is the published contract, so a change to the code that returns the exit code has to
 * change the table with it. Reading the number back out of the document keeps the two in step.
 */
function documentedExitCode(diagnostic: string): number {
  const contributing = readFileSync(
    new URL("../../../../.github/CONTRIBUTING.md", import.meta.url),
    "utf-8",
  );
  const section = contributing.split("## Exit codes")[1];
  if (!section) {
    throw new FliskError("CONTRIBUTING.md has no 'Exit codes' section", [
      "Add an Exit codes section to .github/CONTRIBUTING.md",
    ]);
  }
  const row = section
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .find((line) => line.includes(diagnostic));
  if (!row) {
    throw new FliskError(`CONTRIBUTING.md lists no exit code for "${diagnostic}"`, [
      "Add the diagnostic to the exit-code table in .github/CONTRIBUTING.md",
    ]);
  }
  const code = Number(row.split("|")[1]?.trim().replace(/`/g, ""));
  if (!Number.isInteger(code)) {
    throw new FliskError(`CONTRIBUTING.md has no exit code for "${diagnostic}"`, [
      "Document a numeric exit code in .github/CONTRIBUTING.md",
    ]);
  }
  return code;
}

/** The project config the command reads before it starts anything. */
const PROJECT_JSON = {
  version: "1.0.0",
  project: { name: "env-file-test", version: "1.0.0" },
  phases: BASE_PHASES,
  optional_infra: ALL_OPTIONAL_INFRA_DISABLED,
  discovery: { paths: SERVICES_DISCOVERY_PATHS },
};

/**
 * Windows: the temp dir can stay locked briefly after the command's internals open and close handles in it (AV,
 * Search indexer), past the default retry window, so retry longer than `fs.rmSync`'s default. On Windows the
 * cleanup stays best-effort: a leaked temp dir is less harmful than failing a passing test.
 */
function rmTreeBestEffort(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    if (process.platform !== "win32" && existsSync(dir)) {
      throw error;
    }
  }
}

const COMPLETE_ENV = [
  "TILT_ENV=dev",
  "DB_PASSWORD=local-db-password",
  "JWT_SECRET=local-jwt-secret",
  "",
].join("\n");

type EnvFileFixture = {
  dir: string;
  projectDir: string;
  originalCwd: string;
};

function setupEnvFileProject(): EnvFileFixture {
  const dir = mkdtempSync(join(tmpdir(), "flisk-up-env-file-"));
  // macOS resolves the temporary directory (/var -> /private/var), and the CLI resolves a
  // relative path against the current directory, so the project path is the resolved one.
  const projectDir = realpathSync(dir);
  const originalCwd = process.cwd();
  // A relative --env-file is resolved against the current directory, like Node.js and
  // `docker compose --env-file` resolve it.
  process.chdir(dir);
  vi.stubEnv("FLISK_ALLOW_NATIVE_WINDOWS", "1");
  vi.mocked(findProjectRoot).mockReturnValue(projectDir);
  vi.mocked(requireProjectRoot).mockReturnValue(projectDir);
  // The command reads the project config before it starts anything.
  mkdirSync(join(projectDir, ".flisk"), { recursive: true });
  writeFileSync(join(projectDir, ".flisk", "project.json"), `${JSON.stringify(PROJECT_JSON)}\n`);
  vi.mocked(verifyMasterConfigs).mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
    diffs: [],
    diffLineLimit: 200,
    handEdited: [],
    state: "generated" as const,
  });
  vi.mocked(findProjectTiltPorts).mockResolvedValue({
    running: [],
    foreign: [],
    savedRunning: [],
    unknownSaved: [],
  });
  return { dir, projectDir, originalCwd };
}

function teardownEnvFileProject({
  dir,
  originalCwd,
}: Pick<EnvFileFixture, "dir" | "originalCwd">): void {
  process.chdir(originalCwd);
  rmTreeBestEffort(dir);
  delete process.env[PROJECT_ENV_FILE_VAR];
  delete process.env.TILT_PORT;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
}

function envFileFixture() {
  let state: EnvFileFixture;
  beforeEach(() => {
    state = setupEnvFileProject();
  });
  afterEach(() => {
    teardownEnvFileProject(state);
  });
  return {
    get dir() {
      return state.dir;
    },
    get projectDir() {
      return state.projectDir;
    },
  };
}

const HOST_PORT_PLAN = {
  ingressHttp: 8080,
  ingressHttps: 8443,
  postgres: 5432,
  requested: { ingressHttp: 8080, ingressHttps: 8443, postgres: 5432 },
  explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
  reason: { ingressHttp: "default", ingressHttps: "default", postgres: "default" },
} as const;

const SAVED_TILT_PLAN = {
  ...HOST_PORT_PLAN,
  tiltUi: 10351,
} as const;

// Keep these bindings value-used so the shared re-exports stay runtime exports.
void [
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
  tmpdir,
  join,
  stripVTControlCharacters,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  isTiltfileOrchestration,
  ProjectConfigNotFoundError,
  verifyMasterConfigs,
  captureExit,
  makeResource,
  runCommandInProcess,
  PROJECT_ENV_FILE_VAR,
  requireProjectRoot,
  getHostPortPlan,
  writeSavedHostPortPlan,
  findProjectRoot,
  findAvailablePort,
  discoverResourcesStrict,
  runTilt,
  findProjectTiltPorts,
  listTiltInstances,
  stopOwnedTiltOnPort,
  findTiltProcessIdsOnPort,
  stopTiltOnPort,
  alreadyRunningReport,
  parseTiltPort,
  resolveTiltPort,
  secondUpAction,
  stopTiltForUp,
  readFastNoopState,
  writeFastNoopState,
  tiltGetUiResources,
  waitForTiltResourcesReady,
  upAndWait,
  upWaitServiceHealth,
  checkPrintedUrls,
  foreignOwners,
  DRIFT_EXIT_CODE,
  driftReport,
  enforceDriftGate,
  enforceVersionFloor,
  formatUpSuccess,
  nativeWindowsUpRefusal,
  selectRunEnvFile,
  upCommand,
  waitForTiltUnlessStartupFailed,
  documentedExitCode,
  PROJECT_JSON,
  rmTreeBestEffort,
  COMPLETE_ENV,
  setupEnvFileProject,
  teardownEnvFileProject,
  envFileFixture,
  HOST_PORT_PLAN,
  SAVED_TILT_PLAN,
];

/** Points the mocked project lookups at a generated, drift-free project and allows native Windows. */
export function stubGeneratedProject(): void {
  vi.stubEnv("FLISK_ALLOW_NATIVE_WINDOWS", "1");
  vi.mocked(findProjectRoot).mockReturnValue("/project");
  vi.mocked(requireProjectRoot).mockReturnValue("/project");
  vi.mocked(verifyMasterConfigs).mockReturnValue({
    valid: true,
    errors: [],
    warnings: [],
    diffs: [],
    diffLineLimit: 200,
    handEdited: [],
    state: "generated" as const,
  });
}

/** Collects what the command writes to stdout through the mocked `writeSync`; call `restore` when done. */
export function captureStdoutWriteSync(): { text: () => string; restore: () => void } {
  const original = vi.mocked(writeSync).getMockImplementation();
  vi.mocked(writeSync).mockClear();
  let output = "";
  vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
    if (fd === 1) output += String(data);
    return String(data).length;
  }) as never);
  return {
    text: () => output,
    restore: () => {
      if (original) vi.mocked(writeSync).mockImplementation(original);
    },
  };
}

export {
  afterEach,
  alreadyRunningReport,
  beforeEach,
  COMPLETE_ENV,
  captureExit,
  checkPrintedUrls,
  DRIFT_EXIT_CODE,
  describe,
  discoverResourcesStrict,
  documentedExitCode,
  driftReport,
  enforceDriftGate,
  enforceVersionFloor,
  envFileFixture,
  existsSync,
  expect,
  findAvailablePort,
  findProjectRoot,
  findProjectTiltPorts,
  findTiltProcessIdsOnPort,
  foreignOwners,
  formatUpSuccess,
  getHostPortPlan,
  HOST_PORT_PLAN,
  isTiltfileOrchestration,
  it,
  join,
  listTiltInstances,
  makeResource,
  mkdirSync,
  mkdtempSync,
  nativeWindowsUpRefusal,
  PROJECT_ENV_FILE_VAR,
  PROJECT_JSON,
  ProjectConfigNotFoundError,
  parseTiltPort,
  readFastNoopState,
  readFileSync,
  realpathSync,
  requireProjectRoot,
  resolveTiltPort,
  rmSync,
  rmTreeBestEffort,
  runCommandInProcess,
  runTilt,
  SAVED_TILT_PLAN,
  secondUpAction,
  selectRunEnvFile,
  setupEnvFileProject,
  stopOwnedTiltOnPort,
  stopTiltForUp,
  stopTiltOnPort,
  stripVTControlCharacters,
  teardownEnvFileProject,
  tiltGetUiResources,
  tmpdir,
  upAndWait,
  upCommand,
  upWaitServiceHealth,
  verifyMasterConfigs,
  vi,
  waitForTiltResourcesReady,
  waitForTiltUnlessStartupFailed,
  writeFastNoopState,
  writeFileSync,
  writeSavedHostPortPlan,
  writeSync,
};
