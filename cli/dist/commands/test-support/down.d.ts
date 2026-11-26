import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
declare const runTiltMock: Mock, buildTiltDownArgsMock: Mock, getContainerRuntimeStatusMock: Mock, isTiltAvailableMock: Mock, pruneProjectNetworksMock: Mock, planProjectNetworkPruneMock: Mock, stopProjectTiltUpMock: Mock, waitForTiltUpExitMock: Mock, createJsonEmitterMock: Mock, findRunningFliskProjectsMock: Mock, pruneDockerBuildCacheMock: Mock, trimColimaAndMeasureMock: Mock, stopProjectComposeProjectsMock: Mock, lookupProjectTiltUpPidsMock: Mock, probeProjectIdleMock: Mock, projectComposeProjectsMock: Mock, listProjectArtifactsMock: Mock, removeProjectArtifactsMock: Mock, dropCheckoutDatabasesMock: Mock, foreignOwnersMock: Mock, findComposeWatchersMock: Mock, stopComposeWatchersMock: Mock;
declare const originalCwd: string;
declare const collectLeftoversMock: Mock;
declare const promptConfirmMock: Mock;
import { buildTiltDownArgs } from "../../utils/tilt.js";
import { downCommand } from "../down.js";
declare const VALID_PROJECT_CONFIG: {
    version: string;
    project: {
        name: string;
        version: string;
    };
    phases: {
        [k: string]: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
    };
    optional_infra: {
        readonly monitoring: false;
        readonly elk: false;
        readonly debezium: false;
        readonly golden_image: false;
        readonly verdaccio: false;
    };
    discovery: {
        paths: readonly ["services/**"];
    };
};
declare function setupTestProject(): string;
export declare function downTestContext(): {
    scratchProject: (name: string) => string;
    downFrom: (cwd: string, args: string[]) => Promise<{
        tiltCwd?: string;
        output: string;
    }>;
    downFails: (cwd: string, args: string[]) => Promise<string>;
    originalCwd: string;
};
export declare function setupDownAliasTest(prefix: string): {
    tempDir: string;
    log: Mock<(...data: any[]) => void>;
    warn: Mock<(...data: any[]) => void>;
    cleanup(): void;
};
export declare function expectDownTiltInvocation(): void;
export declare function expectDeprecatedForceNotice(warn: Mock): void;
export declare function expectDeprecatedAliasBehavior(warn: Mock): void;
export { afterEach, beforeEach, buildTiltDownArgs, buildTiltDownArgsMock, collectLeftoversMock, createJsonEmitterMock, describe, downCommand, dropCheckoutDatabasesMock, expect, findComposeWatchersMock, findRunningFliskProjectsMock, foreignOwnersMock, getContainerRuntimeStatusMock, isTiltAvailableMock, it, join, listProjectArtifactsMock, lookupProjectTiltUpPidsMock, mkdirSync, mkdtempSync, originalCwd, planProjectNetworkPruneMock, probeProjectIdleMock, projectComposeProjectsMock, promptConfirmMock, pruneDockerBuildCacheMock, pruneProjectNetworksMock, realpathSync, removeProjectArtifactsMock, rmSync, runTiltMock, setupTestProject, stopComposeWatchersMock, stopProjectComposeProjectsMock, stopProjectTiltUpMock, tmpdir, trimColimaAndMeasureMock, VALID_PROJECT_CONFIG, vi, waitForTiltUpExitMock, writeFileSync, };
