import { type Mock } from "vitest";
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
export declare const runtime: RuntimeMocks;
export declare const toolchain: {
    findToolchainMismatches: MockFn;
};
export declare const occupant: {
    findPortOccupant: MockFn;
};
export declare const errors: {
    showError: MockFn;
};
export declare const secrets: {
    ensureGeneratedSecrets: MockFn;
};
export declare const doctorDeps: {
    worktreeEnvHintMessage: MockFn;
};
export declare const docker: {
    isDockerRunning: MockFn;
};
export declare function nativeRuntimeModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare function toolchainModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare function portOccupantModuleMock(): Record<string, unknown>;
export declare function errorsModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare function generatedSecretsModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare function doctorDepsModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare function nativeContainerModuleMock(importOriginal: ImportOriginal): Promise<Record<string, unknown>>;
export declare class ExitCalled extends Error {
    readonly code: number;
    constructor(code: number);
}
export declare const throwingExit: (code: number) => never;
export declare const api: DiscoveredResource;
export declare const web: DiscoveredResource;
type Handler = (...args: unknown[]) => void;
export declare let handlers: Map<string, Handler>;
export declare let logs: string[];
export declare let warnings: string[];
export declare function registerNativeUpHarness(extra?: MockFn[]): void;
export declare const flush: () => Promise<void>;
export declare function writeServiceLog(root: string, service: string, lines: string[]): void;
export declare const UP_EMIT_PAYLOAD: {
    ok: boolean;
    runtime: string;
    stack: null;
    services: string[];
    requested: string[];
    dependencies: string[];
    urls: {
        service: string;
        url: string;
        didAnswer: boolean;
        status: number;
    }[];
};
export declare function expectUpBanner(output: string): void;
export {};
