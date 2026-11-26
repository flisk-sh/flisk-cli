import { type Mock } from "vitest";
export declare function pathsMockFactory<T extends object>(importOriginal: () => Promise<T>): Promise<T & {
    getPackageVersion: () => string;
}>;
export declare function platformModuleMockFactory<T extends object>(importOriginal: () => Promise<T>): Promise<T & {
    isWindows: () => boolean;
    binaryAssetName: () => string | null;
    executableName: () => string;
}>;
type UpgradeMocks = {
    childProcessMock: {
        execSync: (...args: unknown[]) => unknown;
        execFileSync: (...args: [command: string, commandArgs?: string[], options?: unknown]) => unknown;
    };
    execFileSyncMock: Mock;
    execSyncMock: Mock;
    findAllOnPathMock: Mock;
    findOnPathMock: Mock;
    getPackageVersionMock: Mock;
    npmViewMock: Mock;
    pathsMockFactory: typeof pathsMockFactory;
    platformMock: {
        isWindows: Mock;
        binaryAssetName: Mock;
        executableName: Mock;
    };
    platformModuleMockFactory: typeof platformModuleMockFactory;
    promptConfirmMock: Mock;
    promptMock: {
        promptConfirm: (opts: unknown) => Promise<boolean>;
    };
    sigstoreMock: {
        verify: Mock;
    };
    sigstoreVerifyMock: Mock;
    tarMock: {
        extractTarball: (data: Buffer, destination: string) => void;
    };
    whichMock: {
        findOnPath: (cmd: string) => string | null;
        findAllOnPath: (cmd: string) => string[];
    };
};
export declare const m: UpgradeMocks;
export declare function loadUpgrade(): Promise<typeof import("../../upgrade.js")>;
export declare function registerUpgradeMocks(): void;
export declare function setupUpgradeCommandTests(upgrade: Awaited<ReturnType<typeof loadUpgrade>>): {
    getTmp: () => string;
    runUpgrade: (args?: string[]) => Promise<{
        status: number | undefined;
        stdout: string;
        stderr: string;
    }>;
};
export declare function loadUpgradeWithMocks(): Promise<typeof import("../../upgrade.js")>;
export declare function gitRebuildExecHandler({ branch, mode, }: {
    branch?: string;
    mode: "pull" | "rebase";
}): (_cmd: string, args: string[]) => string;
export declare function gitUpgradeExecHandler({ version, versionError, }?: {
    version?: string;
    versionError?: Error;
}): (_cmd: string, args: string[]) => string;
export declare function stubFetchLatestRelease(tag: string): void;
export declare function stubFetchReleaseNotFound(): void;
export declare function stubFetchLatestThenAssetFailure(): void;
type GitHubReleaseFetchOptions = {
    sumsText: string;
    tag?: string;
    includeChecksumsArrayBuffer?: boolean;
    includeSigstoreMetadata?: boolean;
};
export declare function createGitHubReleaseFetch({ sumsText, tag, includeChecksumsArrayBuffer, includeSigstoreMetadata, }: GitHubReleaseFetchOptions): Mock;
type UpgradeEnvelopeExpectation = {
    currentVersion: string;
    latestVersion: string;
    upgradeAvailable: boolean;
    method: string;
    path: string;
    installations: {
        method: string;
        path: string;
    }[];
};
export declare function expectUpgradeJsonEnvelope(envelope: unknown, expected: UpgradeEnvelopeExpectation): void;
export {};
