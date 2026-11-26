// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../../test-support/index.js";
import { CONTAINER_RUNTIME_CHECK, STANDARD_PORTS } from "../../../utils/constants.js";
import { checkHostPorts, checkIngressPorts, checkPrivateNpmRegistry, checkTiltResourceHealth, findForeignIngressHolders, HOST_PORT_FIXES, orderTiltFailures, parsePublishedPortHolders, parseTiltResourceFailures, probeContainerRuntimeError, summarizeTiltBuildError, } from "../../../utils/doctor-runtime.js";
import { checkSharedStackRoutes } from "../../../utils/doctor-wiring.js";
import { cacheExecAsync, createAsyncCommandCache, createHostCommandCache, } from "../../../utils/host-command-cache.js";
import { checkWindowsDockerMode, checkWindowsHostConfiguration, checkWindowsRuntimeTools, } from "../../../utils/windows-doctor.js";
import { checkDockerCompose, checkDockerVersions, checkFliskVersion, checkPublicEnvSecrets, checkStarlarkLoadExports, DOCTOR_FIXES, doctorCommand, formatDoctorSummary, getDoctorOutcomeMessage, NATIVE_WINDOWS_DOCTOR_MESSAGE, renderDoctorOutput, requiresContainerRuntime, runChecks, WSL2_DOCTOR_MESSAGE, } from "../../doctor.js";
// Stub the host owner lookup so tests never shell out to lsof.
const noOwner = () => null;
vi.mock("../../../utils/windows-doctor.js", () => ({
    checkWindowsRuntimeTools: vi.fn(() => ({
        name: "Windows Runtime Tools",
        didPass: true,
        message: "Docker (docker.exe) and Tilt found on PATH; Bun was not found (generated services need Bun)",
    })),
    checkWindowsDockerMode: vi.fn(() => ({
        name: "Docker container mode",
        didPass: false,
        message: "Docker Desktop is using Windows containers. Switch to Linux containers. Flisk stacks are Linux images.",
        fix: "Switch Docker Desktop to Linux containers. Flisk does not run Windows containers.",
    })),
    checkWindowsHostConfiguration: vi.fn(async () => ({
        name: "Windows ports and DNS",
        didPass: false,
        message: "⚠️ Windows reserved port 80 for Hyper-V/WSL. Fix: disable the conflicting Windows feature or change Flisk ports in project config.\nWindows did not resolve *.flisk.localhost to 127.0.0.1. Browser URLs with hostnames will fail until you fix hosts or use the 127.0.0.1 URLs printed by flisk networks.\ngit core.autocrlf is true; generated files may get CRLF while Docker Linux containers expect LF. Recommended: git config core.autocrlf input in Flisk repos.\nDocker Desktop Settings → Resources → File sharing must include this project directory.",
        fix: "Windows did not resolve *.flisk.localhost to 127.0.0.1. Browser URLs with hostnames will fail until you fix hosts or use the 127.0.0.1 URLs printed by flisk networks.",
    })),
}));
import { CONTAINER_CHECK_NAMES_MAP, CONTAINER_DEPENDENT_CHECK_NAMES, } from "../../../utils/doctor-runner.js";
/** Check names are derived from the runtime registry so tests stay in sync with #4889. */
export const REGISTERED_CONTAINER_CHECK_NAMES = [
    ...new Set([
        ...CONTAINER_DEPENDENT_CHECK_NAMES,
        ...Object.keys(CONTAINER_CHECK_NAMES_MAP),
        ...Object.values(CONTAINER_CHECK_NAMES_MAP),
    ]),
].sort();
export { afterEach, beforeEach, CONTAINER_RUNTIME_CHECK, cacheExecAsync, captureExit, checkDockerCompose, checkDockerVersions, checkFliskVersion, checkHostPorts, checkIngressPorts, checkPrivateNpmRegistry, checkPublicEnvSecrets, checkSharedStackRoutes, checkStarlarkLoadExports, checkTiltResourceHealth, checkWindowsDockerMode, checkWindowsHostConfiguration, checkWindowsRuntimeTools, createAsyncCommandCache, createHostCommandCache, DOCTOR_FIXES, describe, doctorCommand, existsSync, expect, findForeignIngressHolders, formatDoctorSummary, getDoctorOutcomeMessage, HOST_PORT_FIXES, it, join, mkdirSync, mkdtempSync, NATIVE_WINDOWS_DOCTOR_MESSAGE, noOwner, orderTiltFailures, parsePublishedPortHolders, parseTiltResourceFailures, probeContainerRuntimeError, renderDoctorOutput, requiresContainerRuntime, rmSync, runChecks, STANDARD_PORTS, summarizeTiltBuildError, tmpdir, vi, WSL2_DOCTOR_MESSAGE, writeFileSync, };
export function stubLinuxProcess() {
    const originalProcess = process;
    vi.stubGlobal("process", new Proxy(originalProcess, {
        get(target, property) {
            if (property === "platform")
                return "linux";
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    }));
}
export function createVerdaccioProject(prefix, npmrc) {
    const projectRoot = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(projectRoot, ".flisk"), { recursive: true });
    writeFileSync(join(projectRoot, ".flisk", "project.json"), JSON.stringify({
        project: { name: "demo" },
        optional_infra: { verdaccio: true },
        phases: {},
    }));
    if (npmrc)
        writeFileSync(join(projectRoot, ".npmrc"), npmrc);
    return projectRoot;
}
export async function withDoctorCliRun(prefix, projectName, run) {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const originalCwd = process.cwd();
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const log = vi.spyOn(console, "log").mockImplementation(() => { });
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const { exit } = captureExit();
    try {
        if (projectName) {
            mkdirSync(join(root, ".flisk"), { recursive: true });
            writeFileSync(join(root, ".flisk", "project.json"), JSON.stringify({ project: { name: projectName } }));
        }
        process.chdir(root);
        Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
        await run({ root, log, error, exit });
    }
    finally {
        process.chdir(originalCwd);
        if (platformDescriptor)
            Object.defineProperty(process, "platform", platformDescriptor);
        exit.mockRestore();
        log.mockRestore();
        error.mockRestore();
        rmSync(root, { recursive: true, force: true });
    }
}
