// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { DEFAULT_DOCKER_PROBE_TIMEOUT_MS } from "../utils/docker-file-sharing.js";
import { createDoctorUsageReport } from "../utils/doctor-report.js";
import { DEFAULT_PING_TIMEOUT_MS } from "../utils/doctor-services.js";
import { addProjectOption } from "../utils/project-resolution.js";
import { runDoctor } from "./doctor/run.js";
export { checkDockerBuildCache } from "../utils/docker-build-cache.js";
export { checkDockerFileSharing } from "../utils/docker-file-sharing.js";
export { checkColima, checkContainerEngine, checkDockerCompose, checkDockerOperatingSystem, checkDockerRuntime, } from "../utils/doctor-container.js";
export { checkLocalServiceDependencies, checkWorktreeEnv } from "../utils/doctor-local-deps.js";
export { checkFliskVersion, checkLatestFliskVersion, checkPublishedBindAddress, checkWslProjectLocation, WSL2_DOCTOR_MESSAGE, } from "../utils/doctor-machine.js";
export { checkFrontendDockerPreflight, checkGeneratedFiles, checkGeneratedProjectRuntimeAssets, checkResourceDiscovery, checkTypeScriptTypeDependencies, } from "../utils/doctor-project.js";
export { renderDoctorOutput } from "../utils/doctor-render.js";
export { CONTAINER_CHECK_NAMES_MAP, CONTAINER_DEPENDENT_CHECK_NAMES, formatDoctorSummary, getDoctorOutcomeMessage, isContainerDependentCheck, orderDoctorResults, requiresContainerRuntime, runChecks, } from "../utils/doctor-runner.js";
export { checkIngressPorts, checkPrivateNpmRegistry, checkTiltResourceHealth, summarizeServiceProbes, summarizeTiltBuildError, } from "../utils/doctor-runtime.js";
export { checkContainerResourceHealth, checkContainerResourceHealthFor, checkServiceHealth, checkServiceSmoke, } from "../utils/doctor-services.js";
export { checkStarlarkLoadExports } from "../utils/doctor-starlark.js";
export { checkBun, checkDockerVersions, checkPackageRunner, checkTilt, } from "../utils/doctor-tools.js";
export { checkPublicEnvSecrets } from "../utils/public-env-secrets.js";
export { MIN_BUN_VERSION, MIN_TILT_VERSION, versionMeetsMinimum } from "../utils/tool-versions.js";
// Compatibility re-exports for the existing importers and tests. The check bodies live one
// concept per module under `./doctor/checks/`, the check table and its gating expander in
// `./doctor/table.ts`, the `--fix` stage in `./doctor/fix.ts`, the platform early reports in
// `./doctor/platform.ts`, and the run itself in `./doctor/run.ts`.
export { NATIVE_WINDOWS_DOCTOR_MESSAGE } from "./doctor/platform.js";
export const DOCTOR_FIXES = {
    dockerMissing: "See https://docs.docker.com/get-docker/",
    dockerDaemonDown: "Start Docker Desktop, OrbStack, Colima, or Kiri, then retry: flisk doctor",
    tiltMissing: "curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash",
    bunMissing: "curl -fsSL https://bun.sh/install | bash",
    port80: "Stop the process bound to port 80, or stop local nginx/caddy. Then: flisk doctor",
    port5432: "Stop local Postgres or change the host port. Then: flisk doctor",
    notProject: "flisk project --yes",
};
export const doctorCommand = addProjectOption(new Command("doctor"), "doctor")
    .description("Check environment readiness for Flisk")
    .option("--all", "Run every check and show Machine and Project sections with a summary", false)
    .option("--problems-only", "Show only failing checks (in --json mode, drops passed checks and adds summary counts)", false)
    .option("--json", "Output a versioned JSON readiness report", false)
    .exitOverride((error) => {
    if (error.exitCode === 0)
        process.exit(0);
    if (doctorCommand.opts().json) {
        console.log(JSON.stringify(createDoctorUsageReport([{ code: "USAGE", message: error.message }])));
    }
    process.exit(2);
})
    .option("--no-ping", "Skip pinging running services' /health endpoints")
    .option("--no-probe-cache", "Re-run the Docker probes instead of reusing a recent verdict (a cached check is marked (cached))")
    .option("--no-gateway", "Skip gateway checks (ports 80/443)")
    .option("--no-database", "Skip database capability checks")
    .option("--no-docker-probe", "Skip the Docker bind-mount probe (file sharing check)")
    .option("--docker-probe-timeout <ms>", "Hard timeout for the Docker bind-mount probe in milliseconds", String(DEFAULT_DOCKER_PROBE_TIMEOUT_MS))
    .option("--strict", "Fail warnings such as a WSL project under /mnt/c")
    .option("--agents", "Also check for several coding agents working in this checkout (reads process names and agent session file names/mtimes only)", false)
    .option("--fix", "Repair this project's unused Docker networks and leftover doctor probes", false)
    .option("--dry-run", "With --fix: list the repairs without changing anything", false)
    .option("--scope <scope>", "With --fix: project or machine, which also removes unused networks of other Flisk projects", "project")
    .option("-y, --yes", "With --fix: apply every repair without asking", false)
    .option("--ping-timeout <ms>", "Per-service ping timeout in milliseconds", String(DEFAULT_PING_TIMEOUT_MS))
    .addHelpText("after", "\nExamples:\n  flisk doctor\n  flisk doctor --all\n  flisk doctor --agents\n  flisk doctor --fix --dry-run\n  flisk doctor --json")
    .action((options) => runDoctor(options));
