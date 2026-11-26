// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
const runtimeMocks = vi.hoisted(() => ({
    findMissingPrograms: vi.fn(),
    isPortListening: vi.fn(),
    isProcessAlive: vi.fn(),
    readNativeRunState: vi.fn(),
    stopNativeRun: vi.fn(),
    nativeRunStatePath: vi.fn(),
    supervisorStart: vi.fn(),
    supervisorStop: vi.fn(),
    supervisorArgs: [],
}));
const toolchainMocks = vi.hoisted(() => ({ findToolchainMismatches: vi.fn() }));
const occupantMocks = vi.hoisted(() => ({ findPortOccupant: vi.fn() }));
const errorMocks = vi.hoisted(() => ({ showError: vi.fn() }));
const secretMocks = vi.hoisted(() => ({ ensureGeneratedSecrets: vi.fn() }));
const doctorDepsMocks = vi.hoisted(() => ({ worktreeEnvHintMessage: vi.fn() }));
const dockerMocks = vi.hoisted(() => ({ isDockerRunning: vi.fn() }));
export const runtime = runtimeMocks;
export const toolchain = toolchainMocks;
export const occupant = occupantMocks;
export const errors = errorMocks;
export const secrets = secretMocks;
export const doctorDeps = doctorDepsMocks;
export const docker = dockerMocks;
// Each test file registers these factories with its own `vi.mock` calls, which Vitest
// hoists; the module bodies stay here so the files share one mock implementation.
export async function nativeRuntimeModuleMock(importOriginal) {
    const actual = await importOriginal();
    class FakeSupervisor {
        constructor(...args) {
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
export async function toolchainModuleMock(importOriginal) {
    return {
        ...(await importOriginal()),
        findToolchainMismatches: toolchainMocks.findToolchainMismatches,
    };
}
export function portOccupantModuleMock() {
    return { findPortOccupant: occupantMocks.findPortOccupant };
}
export async function errorsModuleMock(importOriginal) {
    return {
        ...(await importOriginal()),
        showError: errorMocks.showError,
    };
}
export async function generatedSecretsModuleMock(importOriginal) {
    return {
        ...(await importOriginal()),
        ensureGeneratedSecrets: secretMocks.ensureGeneratedSecrets,
    };
}
export async function doctorDepsModuleMock(importOriginal) {
    return {
        ...(await importOriginal()),
        worktreeEnvHintMessage: doctorDepsMocks.worktreeEnvHintMessage,
    };
}
export async function nativeContainerModuleMock(importOriginal) {
    return {
        ...(await importOriginal()),
        isDockerRunning: dockerMocks.isDockerRunning,
    };
}
export class ExitCalled extends Error {
    code;
    constructor(code) {
        super(`exit ${code}`);
        this.code = code;
    }
}
export const throwingExit = (code) => {
    throw new ExitCalled(code);
};
export const api = {
    name: "api",
    path: "/tmp/api",
    configPath: "/tmp/api/service.json",
    config: {
        appName: "api",
        appType: "backend",
        command: "node server.js",
        port: 4100,
    },
};
export const web = {
    name: "web",
    path: "/tmp/web",
    configPath: "/tmp/web/service.json",
    config: {
        appName: "web",
        appType: "frontend",
        command: "node web.js",
        port: 4200,
        dependsOn: ["api"],
    },
};
export let handlers;
export let logs;
export let warnings;
function resetMocks(extra) {
    for (const mock of [
        ...Object.values(runtime).filter((value) => typeof value === "function"),
        toolchain.findToolchainMismatches,
        occupant.findPortOccupant,
        errors.showError,
        ...extra,
    ]) {
        mock.mockReset();
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
    const capture = ((event, handler) => {
        handlers.set(event, handler);
        return process;
    });
    vi.spyOn(process, "on").mockImplementation(capture);
    vi.spyOn(process, "once").mockImplementation(capture);
    logs = [];
    warnings = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
        logs.push(args.join(" "));
    });
    vi.spyOn(console, "warn").mockImplementation((...args) => {
        warnings.push(args.join(" "));
    });
}
export function registerNativeUpHarness(extra = []) {
    beforeEach(() => resetMocks(extra));
    afterEach(() => {
        vi.restoreAllMocks();
    });
}
export const flush = async () => {
    for (let i = 0; i < 20; i++)
        await Promise.resolve();
};
export function writeServiceLog(root, service, lines) {
    const dir = join(root, ".flisk", "native", "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${service}.log`), lines.map((line, i) => `${new Date(Date.now() + i).toISOString()} ${line}`).join("\n") + "\n");
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
export function expectUpBanner(output) {
    expect(output).toContain("Flisk is up (local processes, no Docker).");
    expect(output).toContain("Stop: Ctrl+C here, or flisk down from another terminal");
}
