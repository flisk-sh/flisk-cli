// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, type Mock, vi } from "vitest";
import type { DiscoveredResource } from "../../types/index.js";

type MockFn = Mock<(...args: never[]) => unknown>;
type ImportOriginal = <T>() => Promise<T>;

interface RuntimeMocks {
  findMissingPrograms: MockFn;
  isPortListening: MockFn;
  isProcessAlive: MockFn;
  readNativeRunState: MockFn;
  stopNativeRun: MockFn;
  nativeRunStatePath: MockFn;
  supervisorStart: MockFn;
  supervisorStop: MockFn;
  supervisorArgs: unknown[][];
}

const runtimeMocks = vi.hoisted(
  (): RuntimeMocks => ({
    findMissingPrograms: vi.fn(),
    isPortListening: vi.fn(),
    isProcessAlive: vi.fn(),
    readNativeRunState: vi.fn(),
    stopNativeRun: vi.fn(),
    nativeRunStatePath: vi.fn(),
    supervisorStart: vi.fn(),
    supervisorStop: vi.fn(),
    supervisorArgs: [],
  }),
);
const toolchainMocks = vi.hoisted(() => ({ findToolchainMismatches: vi.fn() }));
const occupantMocks = vi.hoisted(() => ({ findPortOccupant: vi.fn() }));
const errorMocks = vi.hoisted(() => ({ showError: vi.fn() }));
const secretMocks = vi.hoisted(() => ({ ensureGeneratedSecrets: vi.fn() }));
const doctorDepsMocks = vi.hoisted(() => ({ worktreeEnvHintMessage: vi.fn() }));
const dockerMocks = vi.hoisted(() => ({ isDockerRunning: vi.fn() }));

export const runtime: RuntimeMocks = runtimeMocks;
export const toolchain: { findToolchainMismatches: MockFn } = toolchainMocks;
export const occupant: { findPortOccupant: MockFn } = occupantMocks;
export const errors: { showError: MockFn } = errorMocks;
export const secrets: { ensureGeneratedSecrets: MockFn } = secretMocks;
export const doctorDeps: { worktreeEnvHintMessage: MockFn } = doctorDepsMocks;
export const docker: { isDockerRunning: MockFn } = dockerMocks;

// Each test file registers these factories with its own `vi.mock` calls, which Vitest
// hoists; the module bodies stay here so the files share one mock implementation.
export async function nativeRuntimeModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<typeof import("../native-runtime.js")>();
  class FakeSupervisor {
    constructor(...args: unknown[]) {
      runtimeMocks.supervisorArgs.push(args);
    }
    start() {
      return runtimeMocks.supervisorStart();
    }
    stop() {
      return runtimeMocks.supervisorStop();
    }
  }
  return {
    ...actual,
    findMissingPrograms: runtimeMocks.findMissingPrograms,
    isPortListening: runtimeMocks.isPortListening,
    isProcessAlive: runtimeMocks.isProcessAlive,
    readNativeRunState: runtimeMocks.readNativeRunState,
    stopNativeRun: runtimeMocks.stopNativeRun,
    nativeRunStatePath: runtimeMocks.nativeRunStatePath,
    NativeSupervisor: FakeSupervisor,
  };
}

export async function toolchainModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<typeof import("../toolchain.js")>()),
    findToolchainMismatches: toolchainMocks.findToolchainMismatches,
  };
}

export function portOccupantModuleMock(): Record<string, unknown> {
  return { findPortOccupant: occupantMocks.findPortOccupant };
}

export async function errorsModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<typeof import("../errors.js")>()),
    showError: errorMocks.showError,
  };
}

export async function generatedSecretsModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<typeof import("../generated-secrets.js")>()),
    ensureGeneratedSecrets: secretMocks.ensureGeneratedSecrets,
  };
}

export async function doctorDepsModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<typeof import("../doctor-local-deps.js")>()),
    worktreeEnvHintMessage: doctorDepsMocks.worktreeEnvHintMessage,
  };
}

export async function nativeContainerModuleMock(
  importOriginal: ImportOriginal,
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<typeof import("../native-container.js")>()),
    isDockerRunning: dockerMocks.isDockerRunning,
  };
}

export class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}
export const throwingExit = (code: number): never => {
  throw new ExitCalled(code);
};

export const api: DiscoveredResource = {
  name: "api",
  path: "/tmp/api",
  configPath: "/tmp/api/service.json",
  config: {
    appName: "api",
    appType: "backend",
    command: "node server.js",
    port: 4100,
  } as DiscoveredResource["config"],
};
export const web: DiscoveredResource = {
  name: "web",
  path: "/tmp/web",
  configPath: "/tmp/web/service.json",
  config: {
    appName: "web",
    appType: "frontend",
    command: "node web.js",
    port: 4200,
    dependsOn: ["api"],
  } as DiscoveredResource["config"],
};

type Handler = (...args: unknown[]) => void;
export let handlers: Map<string, Handler>;
export let logs: string[];
export let warnings: string[];

function resetMocks(extra: MockFn[]): void {
  for (const mock of [
    ...Object.values(runtime).filter((value) => typeof value === "function"),
    toolchain.findToolchainMismatches,
    occupant.findPortOccupant,
    errors.showError,
    ...extra,
  ]) {
    (mock as ReturnType<typeof vi.fn>).mockReset();
  }
  runtime.supervisorArgs.length = 0;
  runtime.findMissingPrograms.mockReturnValue([]);
  runtime.isPortListening.mockResolvedValue(false);
  runtime.isProcessAlive.mockReturnValue(false);
  runtime.readNativeRunState.mockReturnValue(null);
  runtime.stopNativeRun.mockResolvedValue(undefined);
  runtime.supervisorStart.mockResolvedValue([]);
  runtime.supervisorStop.mockResolvedValue(undefined);
  toolchain.findToolchainMismatches.mockReturnValue([]);
  occupant.findPortOccupant.mockReturnValue(null);
  handlers = new Map();
  const capture = ((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return process;
  }) as unknown as typeof process.on;
  vi.spyOn(process, "on").mockImplementation(capture);
  vi.spyOn(process, "once").mockImplementation(capture as unknown as typeof process.once);
  logs = [];
  warnings = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(" "));
  });
}

export function registerNativeUpHarness(extra: MockFn[] = []): void {
  beforeEach(() => resetMocks(extra));
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

export function writeServiceLog(root: string, service: string, lines: string[]): void {
  const dir = join(root, ".flisk", "native", "logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${service}.log`),
    lines.map((line, i) => `${new Date(Date.now() + i).toISOString()} ${line}`).join("\n") + "\n",
  );
}

export const UP_EMIT_PAYLOAD = {
  ok: true,
  runtime: "native",
  stack: null,
  services: ["api", "web"],
  requested: ["web"],
  dependencies: ["api"],
  urls: [
    { service: "api", url: "http://localhost:4100", didAnswer: true, status: 200 },
    { service: "web", url: "http://localhost:4200", didAnswer: true, status: 200 },
  ],
};

export function expectUpBanner(output: string): void {
  expect(output).toContain("Flisk is up (local processes, no Docker).");
  expect(output).toContain("Stop: Ctrl+C here, or flisk down from another terminal");
}
