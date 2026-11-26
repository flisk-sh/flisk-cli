// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execSync } from "node:child_process";
import chalk from "chalk";
import { CLOUD_AGENT_DOCKER_FIX, cloudAgentHostMessage, DEVCONTAINER_DOCKER_FIX, detectHost, isCloudAgentHost, isContainerHost, } from "../../utils/agent-host.js";
import { isDatabaseCapabilityEnabled, isGatewayEnabled, reportedCapabilities, } from "../../utils/capabilities.js";
import { CONTAINER_RUNTIME_CHECK } from "../../utils/constants.js";
import { hasFailedActions } from "../../utils/doctor-fix.js";
import { createDoctorProbeEnvironment, } from "../../utils/doctor-probe-cache.js";
import { createDoctorProgress } from "../../utils/doctor-progress.js";
import { printFixActions, renderDoctorOutput } from "../../utils/doctor-render.js";
import { collectDoctorChecks, createDoctorReport, createDoctorUsageReport, getDoctorExitCode, summarizeDoctorFix, } from "../../utils/doctor-report.js";
import { doctorCheckName, getDoctorOutcomeMessage, orderDoctorResults, runChecks, } from "../../utils/doctor-runner.js";
import { execAsync } from "../../utils/exec-async.js";
import { cacheExecAsync, createAsyncCommandCache, createHostCommandCache, } from "../../utils/host-command-cache.js";
import { getHostPortPlan, resolveRuntimeIngressPort } from "../../utils/host-port-config.js";
import { isNativeContainerService } from "../../utils/native-container.js";
import { findNativeProject, hasNearbyServiceJson } from "../../utils/native-project.js";
import { findProjectRoot, getBuildCommit } from "../../utils/paths.js";
import { isWsl } from "../../utils/platform.js";
import { secretProviderUsageError } from "../../utils/secret-provider.js";
import { EnvUnreadableError, envSecretValues, OUTPUT_WITHHELD, projectSecretValues, redactSecrets, redactValue, } from "../../utils/secret-redaction.js";
import { serviceManifestTypoNotes } from "../../utils/service-manifest.js";
import { discoverResourcesWithProblems, skippedServiceFiles } from "../../utils/services.js";
import { shouldRedrawUpProgress } from "../../utils/up-progress.js";
import { cleanupRunningBinaryArtifacts } from "../../utils/upgrade-cleanup.js";
import { planAndRunDoctorFixes } from "./fix.js";
import { runNativeWindowsDoctor, runWebcontainerDoctor } from "./platform.js";
import { doctorMachineChecks, doctorProjectChecks } from "./table.js";
/**
 * The `flisk doctor` run: validate the flags, print the intro, hand the native-Windows and
 * WebContainer hosts their early reports, run `--fix` first when asked, expand the check
 * table for the run context, run the machine and project sections, then print the JSON or
 * text report (with the same secret masking in both).
 */
export async function runDoctor(options) {
    const providerError = secretProviderUsageError(process.env);
    if (providerError) {
        if (options.json)
            console.log(JSON.stringify(createDoctorUsageReport([{ code: "USAGE", message: providerError.message }])));
        console.error(providerError.message);
        process.exit(providerError.exitCode);
        return;
    }
    // Validate before running any probe; parseInt would silently accept "100ms" or "1.5".
    const pingTimeout = Number(options.pingTimeout);
    if (!/^\d+$/.test(String(options.pingTimeout)) ||
        !Number.isSafeInteger(pingTimeout) ||
        pingTimeout <= 0) {
        const message = "--ping-timeout must be a positive integer number of milliseconds";
        if (options.json)
            console.log(JSON.stringify(createDoctorUsageReport([{ code: "USAGE", message }])));
        console.error(message);
        process.exit(2);
        return;
    }
    const dockerProbeTimeout = Number(options.dockerProbeTimeout);
    if (!/^\d+$/.test(String(options.dockerProbeTimeout)) ||
        !Number.isSafeInteger(dockerProbeTimeout) ||
        dockerProbeTimeout <= 0) {
        const message = "--docker-probe-timeout must be a positive integer number of milliseconds";
        if (options.json)
            console.log(JSON.stringify(createDoctorUsageReport([{ code: "USAGE", message }])));
        console.error(message);
        process.exit(2);
        return;
    }
    const scopeInvalid = !["project", "machine"].includes(String(options.scope));
    const scopeWithoutFix = options.scope !== "project" && !options.fix;
    if (scopeInvalid || scopeWithoutFix || ((options.dryRun || options.yes) && !options.fix)) {
        let message;
        if (scopeInvalid) {
            message = `--scope must be project or machine, got "${options.scope}"`;
        }
        else if (scopeWithoutFix) {
            message = "--scope only applies with --fix";
        }
        else {
            message = `${options.dryRun ? "--dry-run" : "--yes"} only applies with --fix`;
        }
        if (options.json)
            console.log(JSON.stringify(createDoctorUsageReport([{ code: "USAGE", message }])));
        console.error(message);
        process.exit(2);
        return;
    }
    if (!options.dryRun) {
        cleanupRunningBinaryArtifacts();
    }
    // A project whose services all declare `command` runs as local processes: doctor checks only what they need (#2231).
    const nativeProject = findNativeProject();
    const nativeResources = nativeProject?.resources ?? null;
    // A mixed local-process run still needs Docker for its image services; a pure one only needs room for logs and installs.
    const diskRuntime = nativeResources?.some(isNativeContainerService)
        ? "container"
        : "native";
    if (!options.json) {
        console.log(nativeResources
            ? "Flisk doctor checks what this project's local processes need; its services declare commands (and image containers, if any), so Compose and Tilt are not checked."
            : "Flisk doctor checks your local Docker + Tilt development environment; it does not check cluster deployments.");
    }
    const host = detectHost();
    if (process.platform === "win32") {
        await runNativeWindowsDoctor(options, host);
        return;
    }
    if (host.kind === "webcontainer") {
        runWebcontainerDoctor(options, host);
        return;
    }
    if (!options.json) {
        console.log(`\n${chalk.bold("🔍 Flisk Doctor")}\n`);
        console.log("Checking environment...\n");
    }
    // A directory of command services is a project for doctor even before `flisk up` writes its .flisk/project.json.
    const projectRoot = findProjectRoot() ?? nativeProject?.projectRoot ?? null;
    // Repairs run before the checks so the checks report the state after the fix.
    const fixActions = await planAndRunDoctorFixes(options, projectRoot, nativeResources);
    // `.flisk/project.json` and the --no-gateway / --no-database flags decide which shared containers are checked.
    const dbEnabled = isDatabaseCapabilityEnabled(projectRoot, options);
    const gatewayEnabled = isGatewayEnabled(projectRoot, options);
    // A project of local processes starts neither shared container, so it reports no capability (#3873).
    const enabledCapabilities = reportedCapabilities(projectRoot, nativeResources ?? [], options);
    const portCaps = { gateway: gatewayEnabled, database: dbEnabled };
    // One cache per doctor run, so checks that ask Docker the same question share one answer.
    const hostCommandCache = createHostCommandCache();
    // The Compose and Versions checks both read the compose version; this runs it once for the run.
    const cachedExec = cacheExecAsync(execAsync, createAsyncCommandCache());
    // A misspelled service.json key (comand for command) hides a local-process `command`: the project
    // then reads as a container project and a failing container-runtime check blames Docker, so it
    // names the typo too. Discovery is cached, so this costs nothing until a check fails.
    const manifestTypoRoot = projectRoot ?? (hasNearbyServiceJson(process.cwd()) ? process.cwd() : null);
    let manifestTypoNotesCache;
    const manifestTypoNotes = () => {
        if (manifestTypoNotesCache === undefined) {
            manifestTypoNotesCache = manifestTypoRoot
                ? serviceManifestTypoNotes(discoverResourcesWithProblems(manifestTypoRoot).resources)
                : [];
        }
        return manifestTypoNotesCache;
    };
    // Resolved lazily and memoized: a run that stops before the Docker probes never builds the identity, and the
    // file-sharing and network probes share the one resolved value (and the shared `docker version` call behind it).
    let probeEnvironment;
    const probeEnv = () => (probeEnvironment ??= createDoctorProbeEnvironment(cachedExec, {
        enabled: options.probeCache !== false,
    }));
    // The host port plan places the gateway and Postgres containers; a project of local processes has neither.
    let hostPortPlan;
    let portPlanError;
    if (!nativeResources) {
        try {
            hostPortPlan = await getHostPortPlan(projectRoot ?? process.cwd(), {
                database: dbEnabled,
                gateway: gatewayEnabled,
                commandCache: hostCommandCache,
            });
        }
        catch (error) {
            hostPortPlan = null;
            portPlanError = error instanceof Error ? error.message : String(error);
        }
    }
    const ctx = {
        options,
        host,
        projectRoot,
        checkDir: projectRoot ?? process.cwd(),
        nativeResources,
        includeWslChecks: isWsl(),
        gatewayEnabled,
        dbEnabled,
        portCaps,
        hostPortPlan,
        portPlanError,
        hostCommandCache,
        cachedExec,
        manifestTypoNotes,
        probeEnv,
        dockerProbeTimeout,
        diskRuntime,
        execSync,
        pingTimeout,
        // Probe the port a running stack is actually on, not the one the next `flisk up` would pick.
        pingPort: options.ping && !nativeResources
            ? projectRoot
                ? resolveRuntimeIngressPort(projectRoot, hostPortPlan?.ingressHttp)
                : hostPortPlan?.ingressHttp
            : undefined,
    };
    // The check tables drive which checks run and where they slot in; a new check is one module plus one row.
    const machineChecks = doctorMachineChecks(ctx);
    // A cloud coding-agent host gets an informational line first, so its docker-less guidance is visible
    // whether the project runs as local processes (no container checks at all) or would need Docker.
    if (isCloudAgentHost(host.kind)) {
        machineChecks.unshift(() => ({
            name: "Host",
            didPass: true,
            message: cloudAgentHostMessage(host.kind),
        }));
    }
    const projectChecks = doctorProjectChecks(ctx);
    // Right after installing, people run `flisk doctor` before they have a
    // project. Only the machine checks mean anything there; the project checks
    // would all fail with "run flisk project".
    const inProject = Boolean(projectRoot);
    let machineResults = [];
    let projectResults = [];
    let results;
    let errors = [];
    // Plain mode names each check as it runs, so a wedged check keeps its name on screen instead of
    // stalling at "Checking environment...". --json stays silent until the report prints.
    const progress = options.json
        ? undefined
        : createDoctorProgress({
            write: (text) => process.stderr.write(text),
            redraw: shouldRedrawUpProgress({
                isTTY: process.stderr.isTTY,
                quiet: false,
                env: process.env,
            }),
            columns: process.stderr.columns,
        });
    if (options.json || !options.all) {
        const collected = await collectDoctorChecks(machineChecks, inProject ? projectChecks : [], progress ?? {});
        results = collected.checks;
        errors = collected.errors;
    }
    else {
        const runSection = async (sectionChecks, runtimeFailed = false) => {
            const wrapped = sectionChecks.map((check) => {
                const fn = async () => {
                    try {
                        return await check();
                    }
                    catch (err) {
                        errors.push({
                            code: "INTERNAL",
                            message: err instanceof Error ? err.message : String(err),
                        });
                        return {
                            name: check.checkName ?? "Doctor check",
                            didPass: false,
                            isSkipped: false,
                            message: "Check failed with an internal error",
                        };
                    }
                };
                fn.requiresContainerRuntime = check.requiresContainerRuntime;
                fn.checkName = check.checkName;
                fn.progressName = doctorCheckName(check);
                return fn;
            });
            return runChecks(wrapped, {
                all: Boolean(options.all),
                containerRuntimeFailed: runtimeFailed,
                onCheckStart: progress?.onCheckStart,
                onCheckFinish: progress?.onCheckFinish,
            });
        };
        machineResults = await runSection(machineChecks);
        const machineFailed = machineResults.some((result) => !result.didPass && !result.isSkipped && !result.isWarning);
        const runtimeFailed = machineResults.some((result) => result.name === CONTAINER_RUNTIME_CHECK && !result.didPass);
        if (inProject && (options.all || !machineFailed)) {
            projectResults = await runSection(projectChecks, runtimeFailed);
        }
        results = [...machineResults, ...projectResults];
    }
    progress?.finish();
    const runtimeFix = isContainerHost(host.kind)
        ? DEVCONTAINER_DOCKER_FIX
        : isCloudAgentHost(host.kind)
            ? CLOUD_AGENT_DOCKER_FIX
            : undefined;
    if (runtimeFix) {
        for (const result of results) {
            if (result.name === CONTAINER_RUNTIME_CHECK && !result.didPass) {
                result.fix = runtimeFix;
            }
        }
    }
    const buildCommit = getBuildCommit();
    const report = createDoctorReport(orderDoctorResults(results), inProject, errors, hostPortPlan, host, enabledCapabilities, undefined, buildCommit, { problemsOnly: Boolean(options.problemsOnly) });
    // The service.json files discovery skipped (invalid JSON or fields), as `status --json` reports them (#5143).
    if (projectRoot) {
        try {
            const { skipped } = skippedServiceFiles(discoverResourcesWithProblems(projectRoot).problems, projectRoot);
            if (skipped)
                report.data.skipped = skipped;
        }
        catch {
            // A project root that cannot be walked is reported by the project checks.
        }
    }
    if (fixActions)
        report.data.actions = fixActions;
    if (fixActions) {
        const { repairableCount, needsActionCount } = summarizeDoctorFix(results, fixActions);
        report.data.repairableCount = repairableCount;
        report.data.needsActionCount = needsActionCount;
        report.data.repairable = repairableCount;
        report.data.needsAction = needsActionCount;
    }
    const fixFailed = fixActions ? hasFailedActions(fixActions) : false;
    if (fixFailed)
        report.data.ready = false;
    const exitCode = getDoctorExitCode(report);
    const allPassed = report.data.ready;
    if (options.json) {
        let secrets;
        try {
            secrets = envSecretValues(findProjectRoot() ?? process.cwd());
        }
        catch (error) {
            if (!(error instanceof EnvUnreadableError))
                throw error;
            // Without the values the report cannot be published safely, so it is replaced by a structured error.
            console.log(JSON.stringify(createDoctorReport([], inProject, [...errors, { code: "ENV_UNREADABLE", message: error.message }], undefined, undefined, undefined, undefined, buildCommit, { problemsOnly: Boolean(options.problemsOnly) })));
            console.error(error.message);
            process.exit(1);
        }
        console.log(JSON.stringify(redactValue(report, secrets)));
        for (const error of errors)
            console.error(redactSecrets(error.message, secrets));
        if (exitCode !== 0)
            process.exit(exitCode);
        return;
    }
    // The JSON report is masked above; the text report and the check errors quote the same application output, so they are
    // masked too. Without the secret values nothing can be masked, so the report is withheld, as in the JSON branch.
    const textSecrets = projectSecretValues(findProjectRoot() ?? process.cwd());
    if (textSecrets === null) {
        console.error(`${chalk.red("✗")} ${OUTPUT_WITHHELD}`);
        console.error("  Check that the project's .env and --env-file files are readable files.");
        process.exit(1);
    }
    for (const error of errors)
        console.error(`${chalk.red("✗")} Doctor check failed: ${redactSecrets(error.message, textSecrets)}`);
    renderDoctorOutput(redactValue(machineResults, textSecrets), redactValue(projectResults, textSecrets), inProject, options, redactValue(results, textSecrets));
    if (fixActions && fixActions.length === 0) {
        const failedCount = results.filter((check) => !check.didPass && !check.isSkipped && !check.isWarning).length;
        if (!options.json)
            printFixActions(fixActions, options.dryRun, failedCount);
    }
    const outcome = getDoctorOutcomeMessage(inProject, allPassed);
    console.log(`${allPassed ? chalk.green(chalk.bold("✓")) : chalk.red(chalk.bold("✗"))} ${outcome}`);
    if (exitCode !== 0)
        process.exit(exitCode);
}
