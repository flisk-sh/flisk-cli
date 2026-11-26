import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTiltfileOrchestration, ProjectConfigNotFoundError, verifyMasterConfigs } from "../../generator/template-engine.js";
import { captureExit, makeResource } from "../../test-support/index.js";
import { runCommandInProcess } from "../../test-support/run-in-process.js";
import { listTiltInstances } from "../../utils/doctor-wiring.js";
import { PROJECT_ENV_FILE_VAR } from "../../utils/env-selection.js";
import { requireProjectRoot } from "../../utils/errors.js";
import { getHostPortPlan, writeSavedHostPortPlan } from "../../utils/host-port-config.js";
import { findProjectRoot } from "../../utils/paths.js";
import { findAvailablePort } from "../../utils/port-assignment.js";
import { discoverResourcesStrict } from "../../utils/services.js";
import { runTilt } from "../../utils/tilt.js";
import { findProjectTiltPorts, stopOwnedTiltOnPort } from "../../utils/tilt-port-owner.js";
import { findTiltProcessIdsOnPort, stopTiltOnPort } from "../../utils/tilt-process.js";
import { alreadyRunningReport, parseTiltPort, resolveTiltPort, secondUpAction, stopTiltForUp } from "../../utils/tilt-startup.js";
import { readFastNoopState, writeFastNoopState } from "../../utils/up-fast-noop.js";
import { tiltGetUiResources, waitForTiltResourcesReady } from "../../utils/up-readiness.js";
import { upAndWait } from "../../utils/up-wait.js";
import { upWaitServiceHealth } from "../../utils/up-wait-health.js";
import { checkPrintedUrls } from "../../utils/url-check.js";
import { DRIFT_EXIT_CODE, driftReport, enforceDriftGate, enforceVersionFloor, formatUpSuccess, nativeWindowsUpRefusal, selectRunEnvFile, upCommand, waitForTiltUnlessStartupFailed } from "../up.js";
declare const foreignOwners: import("vitest").Mock<() => {
    root: string;
    containers: string[];
}[]>;
/**
 * The exit code the "Exit codes" table in `CONTRIBUTING.md` lists for a diagnostic.
 *
 * The table is the published contract, so a change to the code that returns the exit code has to
 * change the table with it. Reading the number back out of the document keeps the two in step.
 */
declare function documentedExitCode(diagnostic: string): number;
/** The project config the command reads before it starts anything. */
declare const PROJECT_JSON: {
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
/**
 * Windows: the temp dir can stay locked briefly after the command's internals open and close handles in it (AV,
 * Search indexer), past the default retry window, so retry longer than `fs.rmSync`'s default. On Windows the
 * cleanup stays best-effort: a leaked temp dir is less harmful than failing a passing test.
 */
declare function rmTreeBestEffort(dir: string): void;
declare const COMPLETE_ENV: string;
type EnvFileFixture = {
    dir: string;
    projectDir: string;
    originalCwd: string;
};
declare function setupEnvFileProject(): EnvFileFixture;
declare function teardownEnvFileProject({ dir, originalCwd, }: Pick<EnvFileFixture, "dir" | "originalCwd">): void;
declare function envFileFixture(): {
    readonly dir: string;
    readonly projectDir: string;
};
declare const HOST_PORT_PLAN: {
    readonly ingressHttp: 8080;
    readonly ingressHttps: 8443;
    readonly postgres: 5432;
    readonly requested: {
        readonly ingressHttp: 8080;
        readonly ingressHttps: 8443;
        readonly postgres: 5432;
    };
    readonly explicit: {
        readonly ingressHttp: false;
        readonly ingressHttps: false;
        readonly postgres: false;
    };
    readonly reason: {
        readonly ingressHttp: "default";
        readonly ingressHttps: "default";
        readonly postgres: "default";
    };
};
declare const SAVED_TILT_PLAN: {
    readonly ingressHttp: 8080;
    readonly ingressHttps: 8443;
    readonly postgres: 5432;
    readonly requested: {
        readonly ingressHttp: 8080;
        readonly ingressHttps: 8443;
        readonly postgres: 5432;
    };
    readonly explicit: {
        readonly ingressHttp: false;
        readonly ingressHttps: false;
        readonly postgres: false;
    };
    readonly reason: {
        readonly ingressHttp: "default";
        readonly ingressHttps: "default";
        readonly postgres: "default";
    };
    readonly tiltUi: 10351;
};
/** Points the mocked project lookups at a generated, drift-free project and allows native Windows. */
export declare function stubGeneratedProject(): void;
/** Collects what the command writes to stdout through the mocked `writeSync`; call `restore` when done. */
export declare function captureStdoutWriteSync(): {
    text: () => string;
    restore: () => void;
};
export { afterEach, alreadyRunningReport, beforeEach, COMPLETE_ENV, captureExit, checkPrintedUrls, DRIFT_EXIT_CODE, describe, discoverResourcesStrict, documentedExitCode, driftReport, enforceDriftGate, enforceVersionFloor, envFileFixture, existsSync, expect, findAvailablePort, findProjectRoot, findProjectTiltPorts, findTiltProcessIdsOnPort, foreignOwners, formatUpSuccess, getHostPortPlan, HOST_PORT_PLAN, isTiltfileOrchestration, it, join, listTiltInstances, makeResource, mkdirSync, mkdtempSync, nativeWindowsUpRefusal, PROJECT_ENV_FILE_VAR, PROJECT_JSON, ProjectConfigNotFoundError, parseTiltPort, readFastNoopState, readFileSync, realpathSync, requireProjectRoot, resolveTiltPort, rmSync, rmTreeBestEffort, runCommandInProcess, runTilt, SAVED_TILT_PLAN, secondUpAction, selectRunEnvFile, setupEnvFileProject, stopOwnedTiltOnPort, stopTiltForUp, stopTiltOnPort, stripVTControlCharacters, teardownEnvFileProject, tiltGetUiResources, tmpdir, upAndWait, upCommand, upWaitServiceHealth, verifyMasterConfigs, vi, waitForTiltResourcesReady, waitForTiltUnlessStartupFailed, writeFastNoopState, writeFileSync, writeSavedHostPortPlan, writeSync, };
