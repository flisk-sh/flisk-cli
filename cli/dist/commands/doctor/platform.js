// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { WEBCONTAINER_DOCS, WEBCONTAINER_UP_MESSAGE, } from "../../utils/agent-host.js";
import { printDoctorResults } from "../../utils/doctor-render.js";
import { createDoctorReport } from "../../utils/doctor-report.js";
import { createHostPortPlan } from "../../utils/host-port-plan.js";
import { NATIVE_WINDOWS_NEXT_STEP } from "../../utils/native-windows.js";
import { findProjectRoot, getBuildCommit } from "../../utils/paths.js";
import { checkRequiredSecrets } from "../../utils/service-config-checks.js";
import { checkWindowsDockerMode, checkWindowsHostConfiguration, checkWindowsRuntimeTools, } from "../../utils/windows-doctor.js";
export const NATIVE_WINDOWS_DOCTOR_MESSAGE = `Native Windows cannot boot a Docker stack; services that declare a command run as local processes. For a Docker stack use WSL2 Ubuntu with Docker Desktop integration. Guide: docs/start-here-on-windows.md (reference: docs/wsl2.md)`;
/**
 * The native-Windows report: the platform finding plus the Windows diagnostics
 * (kept behind the win32 platform check so Linux/macOS are unchanged), then exit 1.
 */
export async function runNativeWindowsDoctor(options, host) {
    const nativeWindowsFinding = {
        name: "Native Windows support",
        didPass: false,
        message: NATIVE_WINDOWS_DOCTOR_MESSAGE,
        fix: NATIVE_WINDOWS_NEXT_STEP,
    };
    const windowsRoot = findProjectRoot();
    const windowsChecks = [
        nativeWindowsFinding,
        checkWindowsRuntimeTools(),
        checkWindowsDockerMode(),
        await checkWindowsHostConfiguration(),
        // The Windows report returns early; the secret-bridge warning still applies in a project.
        ...(windowsRoot ? [checkRequiredSecrets(windowsRoot, undefined, process.env)] : []),
    ];
    let windowsPortPlan = null;
    try {
        windowsPortPlan = await createHostPortPlan();
    }
    catch {
        /* The native-Windows platform finding remains the primary failure. */
    }
    if (options.json) {
        console.log(JSON.stringify(createDoctorReport(windowsChecks, Boolean(windowsRoot), [], windowsPortPlan, {
            ...host,
            canUp: false,
        }, undefined, undefined, getBuildCommit(), { problemsOnly: Boolean(options.problemsOnly) })));
    }
    else {
        printDoctorResults(windowsChecks, { problemsOnly: Boolean(options.problemsOnly) });
        console.log("");
    }
    console.error(NATIVE_WINDOWS_DOCTOR_MESSAGE);
    process.exit(1);
}
/** The WebContainer report: no Docker daemon or Tilt to check, then exit 1. */
export function runWebcontainerDoctor(options, host) {
    const report = createDoctorReport([
        {
            name: "Host",
            didPass: false,
            message: WEBCONTAINER_UP_MESSAGE,
            fix: `Use a machine with Docker. Guide: ${WEBCONTAINER_DOCS}`,
        },
    ], Boolean(findProjectRoot()), [], undefined, host, undefined, undefined, getBuildCommit(), { problemsOnly: Boolean(options.problemsOnly) });
    if (options.json)
        console.log(JSON.stringify(report));
    console.error(WEBCONTAINER_UP_MESSAGE);
    process.exit(1);
}
