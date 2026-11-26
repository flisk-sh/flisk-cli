import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { captureExit } from "../../../test-support/index.js";
import { CONTAINER_RUNTIME_CHECK, STANDARD_PORTS } from "../../../utils/constants.js";
import { checkHostPorts, checkIngressPorts, checkPrivateNpmRegistry, checkTiltResourceHealth, findForeignIngressHolders, HOST_PORT_FIXES, orderTiltFailures, parsePublishedPortHolders, parseTiltResourceFailures, probeContainerRuntimeError, summarizeTiltBuildError } from "../../../utils/doctor-runtime.js";
import { checkSharedStackRoutes } from "../../../utils/doctor-wiring.js";
import { cacheExecAsync, createAsyncCommandCache, createHostCommandCache } from "../../../utils/host-command-cache.js";
import { checkWindowsDockerMode, checkWindowsHostConfiguration, checkWindowsRuntimeTools } from "../../../utils/windows-doctor.js";
import { checkDockerCompose, checkDockerVersions, checkFliskVersion, checkPublicEnvSecrets, checkStarlarkLoadExports, DOCTOR_FIXES, doctorCommand, formatDoctorSummary, getDoctorOutcomeMessage, NATIVE_WINDOWS_DOCTOR_MESSAGE, renderDoctorOutput, requiresContainerRuntime, runChecks, WSL2_DOCTOR_MESSAGE } from "../../doctor.js";
declare const noOwner: () => null;
/** Check names are derived from the runtime registry so tests stay in sync with #4889. */
export declare const REGISTERED_CONTAINER_CHECK_NAMES: string[];
export type { CheckResult } from "../../../types/index.js";
export { afterEach, beforeEach, CONTAINER_RUNTIME_CHECK, cacheExecAsync, captureExit, checkDockerCompose, checkDockerVersions, checkFliskVersion, checkHostPorts, checkIngressPorts, checkPrivateNpmRegistry, checkPublicEnvSecrets, checkSharedStackRoutes, checkStarlarkLoadExports, checkTiltResourceHealth, checkWindowsDockerMode, checkWindowsHostConfiguration, checkWindowsRuntimeTools, createAsyncCommandCache, createHostCommandCache, DOCTOR_FIXES, describe, doctorCommand, existsSync, expect, findForeignIngressHolders, formatDoctorSummary, getDoctorOutcomeMessage, HOST_PORT_FIXES, it, join, mkdirSync, mkdtempSync, NATIVE_WINDOWS_DOCTOR_MESSAGE, noOwner, orderTiltFailures, parsePublishedPortHolders, parseTiltResourceFailures, probeContainerRuntimeError, renderDoctorOutput, requiresContainerRuntime, rmSync, runChecks, STANDARD_PORTS, summarizeTiltBuildError, tmpdir, vi, WSL2_DOCTOR_MESSAGE, writeFileSync, };
export declare function stubLinuxProcess(): void;
export declare function createVerdaccioProject(prefix: string, npmrc?: string): string;
export declare function withDoctorCliRun(prefix: string, projectName: string | undefined, run: (ctx: {
    root: string;
    log: MockInstance;
    error: MockInstance;
    exit: MockInstance;
}) => void | Promise<void>): Promise<void>;
