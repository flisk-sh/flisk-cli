// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import chalk from "chalk";
import { areMasterFilesStale, ensureProjectRuntimeAssets, generateMasterConfigs, isTiltfileOrchestration, isVendoredEngineStale, isWrappedTiltfileStale, ProjectConfigNotFoundError, readProjectConfig, verifyMasterConfigs, } from "../generator/template-engine.js";
import { CLOUD_AGENT_DOCKER_FIX, DEVCONTAINER_DOCKER_FIX, detectHost, isCloudAgentHost, isContainerHost, WEBCONTAINER_UP_MESSAGE, } from "../utils/agent-host.js";
import { assertGatewayOptOutIsConfigured, disableDatabaseCapability, isDatabaseCapabilityEnabled, isGatewayEnabled, projectNeedsDatabaseKeys, } from "../utils/capabilities.js";
import { claimCheckoutHost } from "../utils/checkout-host.js";
import { exportCheckoutEnv, setCheckoutHostSuffix, } from "../utils/checkout-id.js";
import { cliInvocation } from "../utils/cli-invocation.js";
import { coldStartNotice } from "../utils/cold-start.js";
import { handleDryRun } from "../utils/command-helpers.js";
import { exportCheckoutHostEnv, STANDARD_PORTS } from "../utils/constants.js";
import { assertCheckoutIdentityPersisted } from "../utils/database-name.js";
import { dependsOnOf, unknownBackendNames } from "../utils/dependency-graph.js";
import { diskWarningField, enforceDiskGuard, readDockerVmFreeGib } from "../utils/disk-guard.js";
import { enforceBuildCacheCeiling } from "../utils/docker-build-cache.js";
import { projectConfigEnablesVerdaccio } from "../utils/doctor/process.js";
import { getDeferredResourceNames, summarizeTiltBuildError } from "../utils/doctor-runtime.js";
import { checkLiteralPorts, listTiltInstances } from "../utils/doctor-wiring.js";
import { applyEnvFileSelection, assertEngineSupportsEnvFile, EnvFileError, envFileWarning, PROJECT_ENV_FILE_VAR, selectEnvFile, } from "../utils/env-selection.js";
import { completeEnvFile, scopeCheckoutEnvFile } from "../utils/env-validator.js";
import { errorFactories, FliskError, getErrorMessage, NO_RESOURCES_SUGGESTIONS, requireProjectBeforeDocker, requireProjectRoot, runCommand, showError, showErrorAndExit, withTiltCheck, } from "../utils/errors.js";
import { ensureSmokeRecordsIgnored } from "../utils/file-helpers.js";
import { enforceFliskVersionGate } from "../utils/flisk-version-gate.js";
import { formatCount } from "../utils/formatting.js";
import { ensureGeneratedSecrets } from "../utils/generated-secrets.js";
import { ensureGeneratedRootIgnored } from "../utils/gitignore-generated.js";
import { exportHostPortPlan, getHostPortPlan, readSavedTiltPort, writeSavedHostPortPlan, } from "../utils/host-port-config.js";
import { formatHostPortPlan, isHostPortAvailable } from "../utils/host-port-plan.js";
import { inferNodeProject, inferredStateRoot } from "../utils/inferred-node-project.js";
import { createJsonEmitter } from "../utils/json-output.js";
import { toMachineError } from "../utils/machine-output.js";
import { collectRequiredModels, runModelPreflight } from "../utils/model-preflight.js";
import { isNativeContainerService } from "../utils/native-container.js";
import { findFreePort } from "../utils/native-demo.js";
import { hasNearbyServiceJson } from "../utils/native-project.js";
import { formatImageOnlyRuntimeRefusal, formatMixedRuntimeRefusal, isNativeProject, isNativeService, resolveRuntimeMode, } from "../utils/native-service.js";
import { runNativeUp } from "../utils/native-up.js";
import { nativeWindowsStackRefusal } from "../utils/native-windows.js";
import { findProjectRoot, getPackageVersion } from "../utils/paths.js";
import { findAvailablePort } from "../utils/port-assignment.js";
import { createPortClaimer } from "../utils/port-claims.js";
import { formatPortFallbackNotice } from "../utils/port-fallback-notice.js";
import { findPortContainer, findPortOccupant } from "../utils/port-occupant.js";
import { applyProfiles, declaredProfiles, describeSkipped, } from "../utils/profiles.js";
import { findForeignContainerOwners, upOwnerRefusal } from "../utils/project-owner.js";
import { projectNameAt, recordProjectRoot } from "../utils/project-registry.js";
import { cloneMissingRepos } from "../utils/project-repos.js";
import { absoluteProjectArgs } from "../utils/project-resolution.js";
import { runDatabaseUses, writeRunDatabases } from "../utils/run-databases.js";
import { enforceSchemaVersionGate } from "../utils/schema-version-gate.js";
import { secretProviderUsageError } from "../utils/secret-provider.js";
import { enforceServiceConfigGate, warnModelRunner, warnSchemaVersions, warnSecretConflicts, } from "../utils/service-config-checks.js";
import { applyServiceLocalOverrides } from "../utils/service-local-overrides.js";
import { serviceManifestTypoNotes } from "../utils/service-manifest.js";
import { appendHealthPath, isRoutableService, isRoutedBringYourOwn, isWebUiBringYourOwn, resolveServiceUrl, resolveSubdomainBases, routesAsApi, } from "../utils/service-urls.js";
import { discoverResourcesStrict, discoverResourcesWithProblems, discoverStacks, getResourcesForStack, stackExists, warnAboutSkippedFiles, } from "../utils/services.js";
import { databaseResourceNames, evaluateSharedPlatformPostgres, namesSharedPlatformPostgres, } from "../utils/shared-platform-postgres.js";
import { buildSmokePlans, formatSmokeFailure, runSmokePlans, safeSmokeDeps, } from "../utils/smoke.js";
import { explainFailures, machineProblemFixes, withLoggedReasons } from "../utils/startup-fixes.js";
import { buildStartupReport, isStartupStalled } from "../utils/startup-report.js";
import { formatFailureDetail, formatStartupReport } from "../utils/startup-report-format.js";
import { rankByDistance } from "../utils/suggestions.js";
import { buildTiltUpArgs, runTilt } from "../utils/tilt.js";
import { pruneSupersededTiltImages } from "../utils/tilt-images.js";
import { findProjectTiltPorts, findTiltPortOwner, stopOwnedTiltOnPort, } from "../utils/tilt-port-owner.js";
import { stopTiltOnPort } from "../utils/tilt-process.js";
import { alreadyRunningReport, parseTiltPort, resolveTiltPort, secondUpAction, stopTiltForUp, waitForTiltPortsToStop, } from "../utils/tilt-startup.js";
import { parseExitCode, withUpFailureCodes } from "../utils/up-failure-codes.js";
import { clearFastNoopState, fastNoopUrls, isPlainUp, stackFingerprint, tryFastNoop, UP_STATE_VERSION, writeFastNoopState, } from "../utils/up-fast-noop.js";
import { cloneForUp, isGitRepoArg } from "../utils/up-from-git.js";
import { attachedUpInCiWarning, portConflictHints, upFailureHints } from "../utils/up-hints.js";
import { findUnknownServices, resolveOnlySelection } from "../utils/up-only.js";
import { createUpProgressReporter, fetchWithProgress, shouldRedrawUpProgress, } from "../utils/up-progress.js";
import { evaluateTiltReadiness, getDisabledHealthResourceNames, getOptionalHealthResourceNames, healthProbeCannotRun, tiltGetUiResources, tiltResourceLogs, waitForTiltResourcesReady, withHealthProbeDetails, } from "../utils/up-readiness.js";
import { serviceTimings } from "../utils/up-timings.js";
import { defaultUpWaitDeps, failedWaitMessages, fetchUnhealthyReport, formatUnhealthyLogTails, parseWaitTimeout, unhealthyLogTails, upAndWait, withServiceHealthReport, withUnhealthyLogs, } from "../utils/up-wait.js";
import { unhealthyWaitServiceNames, upWaitServiceHealth, } from "../utils/up-wait-health.js";
import { buildPrintedUrlTargets, checkPrintedUrls, formatUrlFailures, healthUrlOf, printedHealthUrl, tiltResourceHasExited, urlFailureSuggestions, } from "../utils/url-check.js";
import { enableDiscoveredStacks, writeDefaultProjectConfig } from "./project.js";
export function formatUpSuccess(port, options = {}) {
    const { appUrls = [], serviceHealth = [], showLogsHint = serviceHealth.length > 0 } = options;
    const lines = [];
    lines.push("Flisk is up.");
    lines.push(`Tilt UI: http://localhost:${port}`);
    if (serviceHealth.length > 0) {
        // Services with a URL come first. Tilt lists its own resources ((Tiltfile), golden-layers-build, init-networks, the
        // *-config-gen steps, ...) in no useful order, and cutting that mix at ten dropped a running service into "and N more"
        // as soon as one more internal resource existed. Array.prototype.sort is stable, so each group keeps Tilt's order.
        const services = [...serviceHealth].sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)));
        lines.push("Services:");
        for (const svc of services.slice(0, 10)) {
            const icon = svc.status === "ready" ? "✓" : svc.status === "failed" ? (svc.optional ? "⚠" : "✗") : "⟳";
            const urlPart = svc.url ? ` → ${svc.url}` : "";
            const note = svc.status === "failed" && svc.optional ? " (optional health check failing)" : "";
            lines.push(`  ${icon} ${svc.name}${urlPart}${note}`);
        }
        if (services.length > 10) {
            lines.push(`  … and ${services.length - 10} more`);
        }
        // Health check URLs for test infrastructure and monitoring: only services that have one, so internals do not use up the ten.
        const withUrl = services.filter((svc) => svc.url && svc.healthUrl !== null);
        lines.push("Health checks:");
        for (const svc of withUrl.slice(0, 10)) {
            const icon = svc.status === "ready" ? "✓" : svc.status === "failed" ? (svc.optional ? "⚠" : "✗") : "⟳";
            const healthUrl = svc.healthUrl ?? (svc.url ? healthUrlOf(svc.url) : "");
            lines.push(`  ${icon} ${svc.name}: ${healthUrl}`);
        }
        if (withUrl.length > 10) {
            lines.push(`  … and ${withUrl.length - 10} more`);
        }
    }
    else if (appUrls.length > 0) {
        lines.push("App URLs:");
        for (const url of appUrls.slice(0, 5)) {
            lines.push(`  ${url}`);
        }
        if (appUrls.length > 5) {
            lines.push(`   … and ${appUrls.length - 5} more`);
        }
    }
    else {
        lines.push("App URLs:");
        lines.push("  run: flisk networks");
    }
    lines.push("Stop: flisk down");
    if (showLogsHint) {
        lines.push("Logs: flisk logs --service <name>");
    }
    lines.push("Next: flisk help  # or visit https://flisk.sh/docs");
    return lines;
}
/**
 * The native Windows boundary for a command that starts a stack.
 *
 * It lives here because `flisk up` is where the boundary has always been enforced; the
 * one-command demo flow refuses with the same message before it clones or installs anything.
 */
export const nativeWindowsUpRefusal = nativeWindowsStackRefusal;
/** Why `flisk up` cannot work on this host, or null when it may proceed. Docker reachability is only probed in container hosts. */
export async function hostUpRefusal(host = detectHost(), dockerReachable = defaultDockerReachable) {
    if (host.kind === "webcontainer")
        return WEBCONTAINER_UP_MESSAGE;
    if (isContainerHost(host.kind) && !(await dockerReachable()))
        return DEVCONTAINER_DOCKER_FIX;
    // A cloud-agent sandbox reaches `flisk up` only for a container project (a local-process project returns
    // above), so the probe here never delays the run this feature exists for.
    if (isCloudAgentHost(host.kind) && !(await dockerReachable()))
        return CLOUD_AGENT_DOCKER_FIX;
    return null;
}
export async function defaultDockerReachable() {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
        execFile("docker", ["ps"], { timeout: 10_000 }, (error) => resolve(!error));
    });
}
/** Exit status for `flisk up` when generated files no longer match service.json / project.json. */
export const DRIFT_EXIT_CODE = 2;
/**
 * Generated service files edited by hand. Only these block `flisk up`: when service.json itself changed, `flisk up` regenerates
 * the outputs, so stale outputs are the normal edit-then-up loop and not drift.
 */
export function driftReport(projectRoot, resources) {
    let handEdited;
    try {
        ({ handEdited } = verifyMasterConfigs(projectRoot, resources
            ? {
                manifestPaths: resources.map((r) => r.configPath),
                skipManifestValidation: true,
            }
            : undefined));
    }
    catch (error) {
        // A project with no .flisk/project.json has no snapshots to compare. Anything else (a corrupt config) must not skip the gate.
        if (error instanceof ProjectConfigNotFoundError)
            return null;
        throw error;
    }
    if (handEdited.length === 0)
        return null;
    return [
        "Generated files were edited by hand and no longer match service.json:",
        ...handEdited.map((file) => `  ${file}`),
        "Run `flisk config regenerate` to discard the edits, or bypass with `flisk up --ignore-drift`.",
    ];
}
/**
 * Runs before Tilt is started: exits with DRIFT_EXIT_CODE on drift unless `ignoreDrift` is set. With `ignoreDrift` the
 * warning is printed every time, whether or not anything drifted, because the check is skipped and cannot tell.
 */
export function enforceDriftGate(projectRoot, options, exit = process.exit) {
    if (options.ignoreDrift) {
        console.warn(chalk.yellow("Warning: --ignore-drift set; generated files were not checked."));
        return;
    }
    const drift = driftReport(projectRoot, options.resources);
    if (!drift)
        return;
    options.onDrift?.(drift.join("\n"));
    showError(drift.join("\n"));
    exit(DRIFT_EXIT_CODE);
}
/**
 * Checks the project's CLI version requirements before anything starts.
 * Enforces both minFliskVersion and pinnedFliskVersion, including under --dry-run.
 * Kept as a compatibility wrapper for existing callers and tests.
 */
export function enforceVersionFloor(projectRoot, options, currentVersion = getPackageVersion(), exit = process.exit) {
    enforceFliskVersionGate(projectRoot, options, currentVersion, exit);
}
const STARTUP_FAILED = Symbol("startup-failed");
/**
 * Waits for Tilt to exit, unless startup has already failed. A readiness failure reports and exits 1 at once: Tilt keeps
 * running (`flisk down` stops it), so waiting for its exit would hang the command.
 */
export async function waitForTiltUnlessStartupFailed(tiltRun, startupFailure, exit = process.exit) {
    const outcome = await Promise.race([tiltRun, startupFailure.then(() => STARTUP_FAILED)]);
    if (outcome === STARTUP_FAILED)
        exit(1);
    return outcome;
}
export function waitForTiltUi(port, timeoutMs = 30_000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            const socket = connect({ host: "127.0.0.1", port });
            let settled = false;
            const finish = (ready) => {
                if (settled)
                    return;
                settled = true;
                socket.destroy();
                if (ready || Date.now() >= deadline)
                    resolve(ready);
                else
                    setTimeout(attempt, 250);
            };
            socket.once("connect", () => finish(true));
            socket.once("error", () => finish(false));
        };
        attempt();
    });
}
/**
 * The env file of the run. `flisk up --env-file <path>` replaces the project `.env` for the run, so the
 * file is resolved, read and checked before anything is written or started. Without the option the
 * project `.env` stays the env file of the run, exactly as before.
 *
 * @throws FliskError when the file cannot be used; the run stops before it starts
 */
export function selectRunEnvFile(projectRoot, requested) {
    if (requested === undefined)
        return undefined;
    if (!projectRoot) {
        throw errorFactories.notInProject();
    }
    const selection = selectEnvFile(projectRoot, requested);
    // A project created before this option vendored an engine that ignores the selection, so the run
    // would silently use the project .env instead.
    assertEngineSupportsEnvFile(projectRoot);
    return selection;
}
/**
 * explainFailures swaps a bare "exit status N" for the resource log's own reason, which may not state N. Read the status
 * from the original message first, so the failure keeps the service's exit code while showing the explained text.
 */
async function explainReadinessFailures(failures, fetchLogs, occupantOf) {
    const explained = await explainFailures(failures, fetchLogs, occupantOf);
    return explained.map((failure, index) => {
        const exitCode = parseExitCode(failures[index]?.message ?? "");
        return exitCode === null ? failure : { ...failure, exitCode };
    });
}
/**
 * Shared error builder for `up --json` (#4522).
 * Ensures `suggestions` is always a present string[] array.
 */
export function upError(code, message, suggestions = []) {
    return {
        code,
        message,
        suggestions: [...suggestions],
    };
}
/**
 * Ensures UNKNOWN_SERVICE carries helpful suggestions: closest matches when available,
 * otherwise the list of valid service names (#4522).
 */
export function unknownServiceSuggestions(unknown, validNames, closestSuggestions = []) {
    if (closestSuggestions.length > 0) {
        return [...closestSuggestions];
    }
    const ordered = unknown.length === 1 && unknown[0] !== undefined
        ? rankByDistance(unknown[0], validNames)
        : [...validNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ordered.length > 0) {
        return ordered;
    }
    // No names to list: the project is empty, so the way out is to add a resource (#4966).
    return [...NO_RESOURCES_SUGGESTIONS];
}
/** Converts any thrown or returned error to an up MachineError with suggestions array (#4522). */
export function toUpError(error) {
    if (error instanceof FliskError) {
        const machine = toMachineError(error).error;
        return upError(machine.code, machine.message, machine.suggestions ?? []);
    }
    if (typeof error === "object" && error !== null) {
        const err = error;
        const code = typeof err.code === "string" ? err.code : "INTERNAL";
        const message = typeof err.message === "string" ? err.message : String(error);
        const suggestions = Array.isArray(err.suggestions) ? err.suggestions : [];
        return upError(code, message, suggestions);
    }
    return upError("INTERNAL", error instanceof Error ? error.message : String(error), []);
}
/** The machine-readable failure of a refused `--env-file`, and the exit code it stops the run with. */
function envFileFailure(error) {
    const suggestions = error instanceof FliskError ? error.suggestions : [];
    return {
        failure: upError(error instanceof EnvFileError ? error.code : "ENV_FILE_INVALID", getErrorMessage(error), suggestions),
        exitCode: error instanceof FliskError ? error.exitCode : 2,
    };
}
/**
 * Decides whether `flisk up` runs the selection as local processes (#2229). Returns null for today's Docker + Tilt path, which
 * a project without any `command` service always takes. Outside a project, a directory whose services all declare `command`
 * becomes the project. A project whose .flisk/project.json selects its own Tiltfile (`flisk import tiltfile`) also returns null:
 * Tilt runs that Tiltfile through the generated wrapper, whatever its services declare. Refuses (through `fail`) an unknown
 * stack or service, an invalid service.json, and a run that would mix native and container services.
 */
export function selectNativeRun(stackName, only, fail, cwd = process.cwd()) {
    const foundRoot = findProjectRoot(cwd);
    if (!foundRoot && !hasNearbyServiceJson(cwd))
        return null;
    // The imported Tiltfile is the orchestration: the wrapper only include()s it and never reads `command`, so run Tilt.
    if (foundRoot && isTiltfileOrchestration(foundRoot))
        return null;
    const projectRoot = foundRoot ?? cwd;
    let discovered;
    try {
        discovered = discoverResourcesWithProblems(projectRoot);
    }
    catch {
        return null;
    }
    const committed = discovered.resources;
    // Runtime eligibility comes from committed manifests: a local `command` must not move a container
    // service onto the host, or turn a Dockerfile-built project into a native one.
    if (!committed.some(isNativeService))
        return null;
    if (!foundRoot && !isNativeProject(committed))
        return null;
    if (discovered.problems.length > 0) {
        fail("INVALID_SERVICE_CONFIG", discovered.problems
            .map((problem) => `Invalid service.json at ${problem.path}: ${problem.reason}`)
            .join("\n"));
    }
    let requested = committed;
    if (stackName) {
        if (!stackExists(stackName, committed)) {
            const error = errorFactories.stackNotFound(stackName, discoverStacks(committed).map((s) => s.name));
            fail("STACK_NOT_FOUND", error.message, error.suggestions, error.exitCode);
        }
        requested = getResourcesForStack(stackName, committed);
    }
    if (only) {
        const unknown = findUnknownServices(only, requested);
        if (unknown.length > 0) {
            const validNames = requested.map((service) => service.name);
            const error = errorFactories.unknownServices(unknown, validNames);
            const suggestions = unknownServiceSuggestions(unknown, validNames, error.suggestions);
            fail("UNKNOWN_SERVICE", error.message, suggestions, error.exitCode);
        }
    }
    // A process cannot start before what it depends on, so a stack or --only selection always brings its dependsOn closure.
    const names = only ?? requested.map((service) => service.name);
    const selection = resolveOnlySelection(names, committed);
    const { mode, mixed } = resolveRuntimeMode(selection.selected, committed);
    if (mode === "container") {
        // A selection of ready-made images alone is not a mixed run: there is no local process in it, and an image can only
        // start next to one (#3698).
        if (selection.selected.length > 0 && selection.selected.every(isNativeContainerService)) {
            fail("MIXED_RUNTIME", formatImageOnlyRuntimeRefusal(selection.selected.map((service) => service.name), mixed));
        }
        const blamed = selection.selected.some(isNativeService) ? selection.selected : committed;
        const containerNames = blamed
            .filter((service) => !isNativeService(service))
            .map((service) => service.name);
        // A `comand` hides `command`: the service then reads as a Docker service, so the refusal names the typo.
        const named = new Set([...mixed, ...containerNames]);
        const typoNotes = serviceManifestTypoNotes(committed.filter((service) => named.has(service.name)));
        fail("MIXED_RUNTIME", formatMixedRuntimeRefusal(mixed, containerNames, typoNotes));
    }
    // Native path chosen: now read per-machine files. A native stack may still depend on image-based
    // containers (Postgres, Redis); those are not local processes, so their committed runtime config
    // must stay untouched even if a service.local.json sits beside them.
    let all;
    let overrides;
    try {
        const applied = applyServiceLocalOverrides(committed.filter(isNativeService));
        const overridden = new Map(applied.resources.map((resource) => [resource.name, resource]));
        all = committed.map((resource) => overridden.get(resource.name) ?? resource);
        overrides = applied.overrides;
    }
    catch (error) {
        fail("INVALID_SERVICE_CONFIG", error instanceof Error ? error.message : String(error));
    }
    const overriddenSelection = resolveOnlySelection(names, all);
    return {
        projectRoot,
        isNewProject: !foundRoot,
        all,
        selected: overriddenSelection.selected,
        dependencies: only ? overriddenSelection.dependencies : [],
        overrides,
    };
}
/** Flags and environment of this run, for the fast no-op decision. */
export function fastNoopFlags(options, stackName, configuredTiltPort) {
    return {
        force: options.force,
        dryRun: options.dryRun,
        ignoreDrift: options.ignoreDrift,
        ignoreVersion: options.ignoreVersion,
        only: options.only,
        envFile: options.envFile,
        profile: options.profile,
        database: options.database,
        gateway: options.gateway,
        stackName,
        configuredTiltPort,
        env: { ...process.env },
    };
}
/**
 * The already-up answer, in both output modes. `--wait` calls it after its child has exited; an attached `up` calls it
 * before any prerequisite, write or Tilt command. The URLs are printed so a script sees the same addresses a normal
 * start prints.
 */
export function printFastNoopResult(result, options, emit) {
    const { state, services, urls, urlChecks, optionalFailures } = result;
    const optionalWarnings = optionalFailures.map((opt) => `${opt.name} (optional health check): ${opt.message}`);
    const tiltUrl = `http://localhost:${state.tiltPort}`;
    if (emit) {
        emit({
            ok: true,
            alreadyRunning: true,
            stack: state.stack,
            services,
            tiltUrl,
            ...(urls.length > 0 ? { advertisedUrls: urls } : {}),
            // The same per-URL objects a normal start reports, so `data.urls` parsers keep working.
            ...(urlChecks.length > 0 ? { urls: urlChecks } : {}),
            ...(optionalWarnings.length > 0 ? { warnings: optionalWarnings } : {}),
        });
        return;
    }
    if (options.quiet)
        return;
    console.log(chalk.green("Stack is healthy."));
    for (const warning of optionalWarnings)
        console.log(chalk.yellow(`Warning: ${warning}`));
    for (const url of urls)
        console.log(chalk.cyan(`  ${url}`));
    console.log(chalk.gray(`Tilt: ${tiltUrl}`));
    console.log(chalk.gray("It keeps running. `flisk status` shows it, `flisk down` stops it."));
}
/**
 * Records a healthy run so the next `flisk up` can recognize an unchanged stack. Only a plain run of the whole project
 * is recorded: a `--only`, `--force` or `--profile` stack is not the state a later plain `flisk up` may reuse. Returns
 * the URLs of the recorded stack, so the caller can report them in its JSON result too.
 */
function recordHealthyRun(details) {
    const { projectRoot, flags, tiltPort, stack, resources, ingressPort, gatewayEnabled } = details;
    const urls = fastNoopUrls(resources, ingressPort ?? undefined, gatewayEnabled);
    if (!isPlainUp(flags))
        return urls;
    if (details.persist === false) {
        clearFastNoopState(projectRoot);
        return urls;
    }
    const fingerprint = stackFingerprint(projectRoot, flags);
    if (!fingerprint) {
        clearFastNoopState(projectRoot);
        return urls;
    }
    writeFastNoopState(projectRoot, {
        version: UP_STATE_VERSION,
        fingerprint,
        tiltPort,
        // The Tilt process that served this run: if it is replaced, the next `flisk up` takes the normal path.
        tiltPid: findTiltPortOwner(tiltPort)?.pid ?? null,
        stack,
        services: resources.map((r) => r.name),
        ingressPort,
        urls,
    });
    return urls;
}
/**
 * The read-only fast path (#4193): when this project's Tilt already answers with an unchanged, healthy stack, report it
 * without regenerating files, stopping Tilt or starting a build. Any doubt falls back to the normal `up` path.
 */
async function tryFastNoopUp(options, stackName, configuredTiltPort, emit, beforeEmit) {
    const root = findProjectRoot();
    if (!root)
        return false;
    const flags = fastNoopFlags(options, stackName, configuredTiltPort);
    const result = await tryFastNoop(root, flags);
    if (!result)
        return false;
    beforeEmit?.();
    printFastNoopResult(result, options, emit);
    return true;
}
/**
 * `flisk up --wait`: runs `flisk up --json` detached and waits for its one result line, so a script gets an exit code
 * when the stack is healthy instead of an attached command that never returns.
 */
async function runUpWait(options, timeoutSeconds, emit) {
    const outcome = await upAndWait(absoluteProjectArgs(process.argv.slice(2), process.cwd(), typeof options.project === "string" ? options.project : undefined), timeoutSeconds, defaultUpWaitDeps(cliInvocation), process.cwd());
    // A failed or timed-out wait names what was unhealthy with the last lines of its log, the reason (a traceback, a
    // missing variable) a person would otherwise look up with `flisk logs --unhealthy` (#3823). The services
    // `flisk logs` names carry why they are not healthy, so a dependent that was never started is told apart from
    // the service actually blocking the start (#5109).
    const report = outcome.kind === "failed" || outcome.kind === "timeout"
        ? await fetchUnhealthyReport(cliInvocation, process.cwd())
        : null;
    const unhealthy = report === null ? [] : unhealthyLogTails(report.lines, { unhealthy: report.unhealthy });
    // And under --json, each service's state and a short reason, so a script or agent acts without parsing
    // text (#3102).
    const serviceHealth = options.json && outcome.kind !== "ready"
        ? ((await upWaitServiceHealth({
            cwd: process.cwd(),
            only: options.only,
            preferReasons: waitFailureReasons(outcome),
        })) ?? [])
        : [];
    if (outcome.kind === "ready" || outcome.kind === "failed") {
        if (options.json) {
            const result = JSON.parse(outcome.kind === "failed"
                ? withServiceHealthReport(withLogsInResult(outcome.json, unhealthy), serviceHealth)
                : outcome.json);
            emit?.(result.data ?? {}, result.errors ?? []);
        }
        else {
            const parsed = JSON.parse(outcome.json);
            if (outcome.kind === "ready") {
                console.log(chalk.green("Stack is healthy."));
                // A no-op run (#4193) carries the advertised URLs of the running stack, so a script sees the same
                // addresses a normal start prints. `data.urls` remains the per-URL URLCheck[] contract of `up --json`.
                const advertised = Array.isArray(parsed.data?.advertisedUrls)
                    ? parsed.data.advertisedUrls
                    : [];
                for (const url of advertised) {
                    if (typeof url === "string")
                        console.log(chalk.cyan(`  ${url}`));
                }
                const warnings = Array.isArray(parsed.data?.warnings) ? parsed.data.warnings : [];
                for (const warning of warnings) {
                    if (typeof warning === "string")
                        console.log(chalk.yellow(`Warning: ${warning}`));
                }
                if (parsed.data?.tiltUrl)
                    console.log(chalk.gray(`Tilt: ${parsed.data.tiltUrl}`));
                console.log(chalk.gray("It keeps running. `flisk status` shows it, `flisk down` stops it."));
            }
            else {
                showError(`flisk up failed:\n  ${failedWaitMessages(parsed, unhealthy).join("\n  ")}`);
            }
        }
        process.exit(outcome.kind === "ready" ? 0 : 1);
    }
    const reason = outcome.kind === "timeout"
        ? `the stack was not healthy after ${timeoutSeconds} seconds (the log is ${outcome.logFile})`
        : outcome.kind === "exited"
            ? `flisk up exited with code ${outcome.exitCode ?? "unknown"} before the stack was ready`
            : `could not start flisk up: ${outcome.message}`;
    const code = outcome.kind === "timeout" ? "UP_WAIT_TIMEOUT" : "UP_WAIT_FAILED";
    const suggestions = outcome.kind === "timeout"
        ? ["`flisk status` shows which services are not healthy", "`flisk down` stops the stack"]
        : [];
    const failures = withUpFailureCodes(withUnhealthyLogs([], unhealthy));
    emit?.({
        ok: false,
        ...(failures.length > 0 ? { failures } : {}),
        services: serviceHealth,
        unhealthy: unhealthyWaitServiceNames(serviceHealth),
    }, [upError(code, reason, suggestions)]);
    if (!options.json) {
        const logs = formatUnhealthyLogTails(unhealthy);
        // The services' own lines say more than the tail of `flisk up`'s output, so they replace it when there are any.
        const tail = logs.length > 0 ? logs.join("\n") : "logTail" in outcome ? outcome.logTail.trim() : "";
        showError(`${reason}${tail ? `\n${tail}` : ""}`, undefined, suggestions);
    }
    process.exit(1);
}
/** The `reason` each named failure in a wait outcome's `flisk up --json` result carries, when it has one. */
function waitFailureReasons(outcome) {
    if (!("json" in outcome))
        return undefined;
    try {
        const parsed = JSON.parse(outcome.json);
        const reasons = new Map();
        for (const failure of parsed.data?.failures ?? []) {
            const reason = failure.reason ?? failure.message;
            if (failure.name && reason)
                reasons.set(failure.name, reason);
        }
        return reasons.size > 0 ? reasons : undefined;
    }
    catch {
        return undefined;
    }
}
/** The `flisk up --json` result line with the unhealthy services' log lines added to its failures. */
function withLogsInResult(json, unhealthy) {
    if (unhealthy.length === 0)
        return json;
    try {
        const parsed = JSON.parse(json);
        if (!parsed.data)
            return json;
        parsed.data.failures = withUpFailureCodes(withUnhealthyLogs(parsed.data.failures ?? [], unhealthy));
        return JSON.stringify(parsed);
    }
    catch {
        return json;
    }
}
/** The first-start notice for this run, or null. A project.json that cannot be read only skips the notice. */
async function upColdStartNotice(projectRoot, services) {
    let projectName;
    try {
        projectName = readProjectConfig(projectRoot).project.name;
    }
    catch {
        return null;
    }
    return coldStartNotice(projectName, services);
}
/** Every stack of the project, for the record `flisk projects --stale` reads; empty when discovery fails. */
function recordableStacks(projectRoot) {
    try {
        return discoverStacks(discoverResourcesWithProblems(projectRoot).resources).map((s) => s.name);
    }
    catch {
        return [];
    }
}
/**
 * Clones the repositories declared in .flisk/project.json that are missing. Returns true when one was cloned.
 * Throws one FliskError listing every failed repository, so `flisk up` reports them all, not only the first.
 */
async function cloneDeclaredRepos(projectRoot) {
    let repos;
    try {
        repos = readProjectConfig(projectRoot).repos;
    }
    catch {
        // A missing or invalid project.json is reported by the checks that run next.
    }
    if (!repos || repos.length === 0)
        return false;
    const results = await cloneMissingRepos(projectRoot, repos);
    const failures = results.filter((result) => result.failed);
    if (failures.length > 0) {
        throw new FliskError(failures.length === 1
            ? "Failed to clone a configured repository"
            : `Failed to clone ${failures.length} configured repositories`, failures.map((failure) => `${failure.dir}: ${failure.reason ?? "git clone failed"}`));
    }
    return results.some((result) => result.cloned);
}
/** Directories of declared repositories that do not exist yet. */
function missingDeclaredRepoDirs(projectRoot) {
    if (!projectRoot)
        return [];
    let repos;
    try {
        repos = readProjectConfig(projectRoot).repos;
    }
    catch {
        return [];
    }
    return (repos ?? []).map((repo) => repo.dir).filter((dir) => !existsSync(join(projectRoot, dir)));
}
/**
 * Probes every URL `flisk up` prints for the started services (#3211): "ready" means each one answers. A URL that does not is
 * diagnosed from the Tilt resource (exited) and its logs (a missing environment variable).
 */
export async function checkStackUrls(tiltPort, resources, ingressPort, deferred, deps = {}) {
    const targets = buildPrintedUrlTargets(resources, ingressPort, deferred);
    if (targets.length === 0)
        return [];
    let uiResources;
    return (deps.check ?? checkPrintedUrls)(targets, {
        diagnosis: {
            hasExited: async (name) => {
                uiResources ??= tiltGetUiResources(tiltPort);
                const json = await uiResources;
                return json ? tiltResourceHasExited(json, name) : null;
            },
            logs: (name) => tiltResourceLogs(tiltPort, name),
        },
    });
}
/** The note `flisk up` prints for services a profile kept out. */
function skippedProfilesNote(skipped) {
    return `Not starting ${describeSkipped(skipped)}: add --profile <name> to start them`;
}
/** Refuses a --profile name that no service declares, which is almost always a typo. */
function assertKnownProfiles(requested, resources, emit) {
    if (!requested || requested.length === 0)
        return;
    const known = declaredProfiles(resources);
    const unknown = requested.filter((name) => !known.includes(name));
    if (unknown.length === 0)
        return;
    const message = `No service declares the profile ${unknown.map((name) => `"${name}"`).join(", ")}.`;
    const suggestions = [
        known.length > 0
            ? `Profiles in this project: ${known.join(", ")}`
            : 'No service has "profiles" in its service.json yet',
    ];
    emit?.({ ok: false }, [upError("UNKNOWN_PROFILE", message, suggestions)]);
    showErrorAndExit(message, 2, suggestions);
}
/**
 * Builds the run `upSteps` fills in: the input, the --json/human report plumbing, the one exit primitive
 * every step's refusal goes through, and the products initialised empty.
 */
export function createUpRun(stackName, options) {
    const baseEmit = options.json ? createJsonEmitter("UP_FAILED", "flisk up") : undefined;
    const run = {
        stackName,
        options,
        baseEmit,
        emit: undefined,
        projectWarnings: [],
        diskWarning: undefined,
        didFinish: false,
        fail(code, message, suggestions = [], exitCode = 1) {
            run.emit?.({ ok: false }, [upError(code, message, suggestions)]);
            return showErrorAndExit(message, exitCode, suggestions);
        },
        failError(error) {
            run.emit?.({ ok: false }, [toUpError(error)]);
            return error.exit();
        },
        guardDisk(isDockerRun) {
            // Before any build or process starts: fail below the hard threshold, warn below the soft one (#3708).
            if (run.options.dryRun)
                return;
            const disk = enforceDiskGuard({
                vmFreeGib: isDockerRun ? readDockerVmFreeGib() : null,
                runtime: isDockerRun ? "container" : "native",
                emit: run.baseEmit,
                quiet: run.options.quiet || run.options.json,
                warn: (line) => console.warn(chalk.yellow(line)),
            });
            run.diskWarning = diskWarningField(disk) ?? run.diskWarning;
        },
        versionRoot: null,
        hasClonedRepos: false,
        schemaRoot: null,
        foundRoot: null,
        projectRoot: "",
        gatewayEnabled: false,
        resources: [],
        stackNames: [],
        pendingClone: [],
        noResources: false,
        unknownDependsOn: [],
        unknownBackends: [],
        savedTiltPort: null,
        servicesToStart: [],
        dependencyNames: [],
        focusServiceNames: [],
        stackDescription: "",
        serviceNames: [],
        checkoutIdentity: null,
        hostSuffix: null,
        tiltArgs: [],
        dryRunCommand: "",
        watchedPort: 0,
        candidatePorts: [],
        force: false,
        tiltPort: 0,
        smokePlans: [],
        uiReady: false,
        jsonReady: false,
        startedServices: [],
        startedDependencies: [],
        startupFailed: false,
        smokeFailed: false,
        printedSuccess: false,
        startupFailure: Promise.resolve(),
        signalStartupFailed() { },
    };
    // Non-blocking findings (low disk, secret bridge) ride along in every successful --json result.
    run.emit = baseEmit
        ? (data, errors = []) => {
            const mappedErrors = errors.map((err) => upError(err.code, err.message, err.suggestions));
            if (data.ok !== true) {
                baseEmit(data, mappedErrors);
                return;
            }
            const existingWarnings = Array.isArray(data.warnings) ? data.warnings : [];
            const combinedWarnings = [...run.projectWarnings, ...existingWarnings];
            baseEmit({
                ...data,
                ...(run.diskWarning ? { diskWarning: run.diskWarning } : {}),
                ...(combinedWarnings.length > 0 ? { warnings: combinedWarnings } : {}),
            }, mappedErrors);
        }
        : undefined;
    return run;
}
/** The `flisk up` refusal for an empty project, shared by the selection check and the start step (#4966). */
function refuseNoResources(run) {
    const error = errorFactories.noResources();
    return run.failError(error);
}
const isRealRun = (run) => !run.options.dryRun;
const isDryRun = (run) => Boolean(run.options.dryRun);
// ---- preflight steps: the gates every run passes before a runtime is chosen ----
/** Refuses an invalid FLISK_SECRET_PROVIDER before anything else, in both output modes. */
function upSecretProvider(run) {
    const providerError = secretProviderUsageError(process.env);
    if (providerError) {
        run.baseEmit?.({ ok: false }, [
            upError("USAGE", providerError.message, providerError.suggestions),
        ]);
        console.error(providerError.message);
        process.exit(providerError.exitCode);
    }
}
/** `flisk up <git-url>`: clone the repository into ./<name> and start it from there, as a plain `flisk up` would. */
async function upGitClone(run) {
    if (!isGitRepoArg(run.stackName))
        return;
    try {
        const dir = await cloneForUp(run.stackName, {
            log: run.options.json || run.options.quiet ? undefined : (line) => console.log(chalk.gray(line)),
        });
        process.chdir(dir);
    }
    catch (error) {
        if (error instanceof FliskError) {
            return run.failError(error);
        }
        throw error;
    }
    run.stackName = undefined;
}
/**
 * `flisk up --wait`: runs `flisk up --json` detached and waits for its one result line. The timeout is validated
 * first, even for a dry run, so a bad --wait-timeout fails exactly as it fails a real wait.
 */
async function upWait(run) {
    if (!run.options.wait)
        return;
    const timeout = parseWaitTimeout(run.options.waitTimeout);
    if (!timeout.ok) {
        return run.fail("INVALID_WAIT_TIMEOUT", timeout.message, ["--wait-timeout 600"], 2);
    }
    // A dry run only prints the plan, so it skips --wait: the detached `flisk up --json` child would report the
    // dry-run envelope's `ok: true` as a healthy stack that nothing started (#3696).
    if (!run.options.dryRun) {
        await runUpWait(run.options, timeout.seconds, run.emit);
        run.didFinish = true;
    }
}
/** --json implies --quiet: stdout carries the envelope only. */
function upJsonQuiet(run) {
    if (run.options.json)
        run.options.quiet = true;
}
/** An invalid TILT_PORT refuses before anything else reads it. */
function upTiltPort(run) {
    const portSetting = parseTiltPort(process.env.TILT_PORT);
    if (!portSetting.ok) {
        run.fail("INVALID_TILT_PORT", portSetting.message, upFailureHints({ kind: "invalid-tilt-port" }));
    }
    run.configuredTiltPort = portSetting.port;
}
/**
 * A second `flisk up` on an unchanged, healthy stack must not regenerate files or start a build (#4193). Only
 * read-only checks run here, before the host, Docker, disk and version gates; any doubt takes the normal path.
 */
async function upFastNoop(run) {
    run.fastFlags = fastNoopFlags(run.options, run.stackName, run.configuredTiltPort);
    if (isPlainUp(run.fastFlags)) {
        // Only run the fast container disk-warning check once the fast path actually matches a Docker/Tilt stack:
        // native projects and cold stacks must fall through to the normal disk guard without calling container rules.
        const fastResult = await tryFastNoopUp(run.options, run.stackName, run.configuredTiltPort, run.emit, () => {
            if (run.emit) {
                run.diskWarning =
                    diskWarningField(enforceDiskGuard({ emit: run.baseEmit, quiet: true })) ??
                        run.diskWarning;
            }
        });
        if (fastResult)
            run.didFinish = true;
    }
}
/**
 * First, before the host/Docker checks below: an old CLI must stop with one clear line, not a half-working stack.
 */
function upVersionFloor(run) {
    run.versionRoot = findProjectRoot();
    if (run.versionRoot) {
        enforceVersionFloor(run.versionRoot, {
            ignoreVersion: run.options.ignoreVersion,
            onFail: (message, status) => run.emit?.({ ok: false }, [
                upError(status === "mismatch" ? "FLISK_VERSION_MISMATCH" : "FLISK_VERSION_TOO_OLD", message),
            ]),
        });
    }
}
/**
 * Declared repositories are cloned before either path discovers services, so a native run and a container run both see
 * the services they hold. A dry run never clones: it reports what is missing instead.
 */
async function upCloneDeclaredRepos(run) {
    if (run.options.dryRun)
        return;
    const declaredRoot = findProjectRoot();
    if (declaredRoot) {
        try {
            run.hasClonedRepos = await cloneDeclaredRepos(declaredRoot);
        }
        catch (error) {
            if (error instanceof FliskError) {
                return run.failError(error);
            }
            throw error;
        }
    }
}
/**
 * A plain Node repo with no project root, service.json, Compose, or Tiltfile: infer one service from package.json.
 * Inference is skipped when a stack name, --only, --env-file or --profile is given.
 */
async function upInferredNodeProject(run) {
    const inferredProject = inferNodeProject(process.cwd());
    if (inferredProject &&
        !run.stackName &&
        !run.options.only &&
        !run.options.envFile &&
        !run.options.profile) {
        const stateRoot = inferredStateRoot(process.cwd());
        // No --port/-p in the script: take the first free port from 3000; runNativeUp passes it to the process as PORT.
        const service = inferredProject.service;
        if (service.config && service.config.port === undefined) {
            service.config.port = await findFreePort(3000);
        }
        if (!run.options.quiet) {
            console.log(chalk.gray(`Inferred service from package.json: ${inferredProject.service.name}`));
        }
        run.guardDisk(false);
        await runNativeUp({
            projectRoot: stateRoot,
            selected: [service],
            dependencies: [],
            dryRun: run.options.dryRun,
            quiet: run.options.quiet,
            force: run.options.force,
            emit: run.emit,
            inferred: { command: inferredProject.command, script: inferredProject.script },
        });
        run.didFinish = true;
    }
}
/**
 * Every selected service declares `command`: run them as local processes, with no Docker, Compose, Tilt or generated
 * files (#2229). Decided before any Docker or Tilt check; a project without `command` services never enters this branch.
 */
async function upNativeRun(run) {
    const nativeRun = selectNativeRun(run.stackName, run.options.only, run.fail);
    // Local processes need no Docker, Tilt or WSL2, so native Windows runs them; the WSL2 refusal below is for container runs.
    if (nativeRun) {
        const { projectRoot } = nativeRun;
        if (nativeRun.overrides.length > 0 && !run.emit && !run.options.quiet) {
            const summary = nativeRun.overrides
                .map(({ service, field }) => `${service}: ${field}`)
                .join(", ");
            console.log(chalk.yellow(`ℹ️  Local overrides active (service.local.json): ${summary}`));
        }
        let envFilePath;
        if (run.options.envFile !== undefined) {
            try {
                envFilePath = selectEnvFile(projectRoot, run.options.envFile).path;
            }
            catch (error) {
                const { failure, exitCode } = envFileFailure(error);
                return run.fail(failure.code, failure.message, failure.suggestions, exitCode);
            }
        }
        if (!nativeRun.isNewProject) {
            enforceSchemaVersionGate(projectRoot, {
                resources: nativeRun.all,
                onInvalid: (message) => run.emit?.({ ok: false }, [upError("INVALID_SCHEMA_VERSION", message)]),
            });
        }
        enforceServiceConfigGate(projectRoot, {
            resources: nativeRun.all,
            onInvalid: (message) => run.emit?.({ ok: false }, [upError("INVALID_SERVICE_CONFIG", message)]),
            onWarning: (message) => run.projectWarnings.push(message),
        });
        if (nativeRun.isNewProject && !run.options.dryRun) {
            writeDefaultProjectConfig(projectRoot);
            if (!run.options.quiet) {
                console.log(chalk.gray("Created .flisk/project.json (this directory is now a Flisk project)"));
            }
        }
        const nativeProfiles = applyProfiles(nativeRun.selected, run.options.profile ?? [], run.options.only ?? []);
        assertKnownProfiles(run.options.profile, nativeRun.all, run.emit);
        if (nativeProfiles.skipped.length > 0 && !run.options.quiet) {
            console.log(chalk.gray(skippedProfilesNote(nativeProfiles.skipped)));
        }
        run.guardDisk(false);
        // A native run has no Tilt process to discover, so record the folder with the same registry `flisk up` keeps for
        // container projects. Commands run outside the project then find its `.flisk/native/run.json` (#4412).
        recordProjectRoot(projectRoot, { stacks: recordableStacks(projectRoot) });
        await runNativeUp({
            projectRoot,
            selected: nativeProfiles.kept,
            dependencies: nativeRun.dependencies,
            stackName: run.stackName,
            only: run.options.only,
            envFilePath,
            dryRun: run.options.dryRun,
            quiet: run.options.quiet,
            force: run.options.force,
            emit: run.emit,
        });
        run.didFinish = true;
    }
}
/**
 * Find the project before the host gate and before pruning images, trimming build cache, or probing Docker (#4282).
 * Outside a project that is the answer on every platform: native Windows would otherwise hide it behind the WSL2
 * refusal, which is only relevant to a container stack that actually exists.
 */
function upRequireProject(run) {
    run.envFileRoot = requireProjectBeforeDocker(() => run.versionRoot ?? findProjectRoot(), (error) => run.failError(error));
}
/** Native Windows runs local-process projects; a container stack still needs WSL2. */
function upPlatformGate(_run) {
    const platformRefusal = nativeWindowsUpRefusal(process.platform, process.env.FLISK_ALLOW_NATIVE_WINDOWS);
    if (platformRefusal)
        showErrorAndExit(platformRefusal);
}
/**
 * The env file of the run. `--env-file` replaces the project .env for this run, so the file is
 * resolved and read before any prerequisite check, any write and any service starts.
 */
function upEnvFile(run) {
    if (run.options.envFile === undefined) {
        // Without the option the project .env is the env file of the run, whatever the environment
        // carries: an inherited FLISK_ENV_FILE must not change the default.
        delete process.env[PROJECT_ENV_FILE_VAR];
    }
    if (run.options.envFile !== undefined) {
        try {
            run.envFileSelection = selectRunEnvFile(run.envFileRoot ?? null, run.options.envFile);
        }
        catch (error) {
            const { failure, exitCode } = envFileFailure(error);
            run.fail(failure.code, failure.message, failure.suggestions, exitCode);
        }
        if (run.envFileSelection && run.envFileRoot) {
            applyEnvFileSelection(run.envFileSelection);
            if (!run.options.quiet) {
                console.log(chalk.gray(`Using env file: ${run.envFileSelection.relativePath} (the project .env is not read in this run)`));
            }
            const warning = envFileWarning(run.envFileRoot, run.envFileSelection);
            // stderr, not stdout: in --json mode stdout carries the JSON envelope only.
            if (warning)
                console.warn(chalk.yellow(warning));
        }
    }
}
/** A container host without a reachable Docker, or a WebContainer, cannot run the container path. */
async function upHostGate(run) {
    const hostRefusal = run.options.dryRun ? null : await hostUpRefusal();
    if (hostRefusal) {
        return run.fail("HOST_UNSUPPORTED", hostRefusal);
    }
}
/**
 * The shared build cache has a size ceiling (20 GiB; FLISK_BUILD_CACHE_MAX_GIB): trim it first, so the disk check sees
 * the space. The `docker system df` behind it is throttled: at most every 6 h while the cache is far below the ceiling (#3860).
 */
async function upDockerMaintenance(run) {
    if (run.options.dryRun)
        return;
    // Rebuilds leave every superseded tilt-<hash> tag behind; a stack that is never stopped never reaches
    // the cleanup in `flisk down`, so trim them here too (#4067). Images a container uses are refused.
    const tilt = await pruneSupersededTiltImages(1);
    if (tilt.removed.length > 0 && !run.options.quiet) {
        console.log(chalk.gray(`Removed ${tilt.removed.length} superseded tilt-* image(s) (up to ${(tilt.removedBytes / 1e9).toFixed(1)} GB).`));
    }
    const cache = await enforceBuildCacheCeiling();
    if (cache.pruned && !run.options.quiet) {
        console.log(chalk.gray(`Build cache was ${cache.sizeGib?.toFixed(1)} GiB; trimmed to ${cache.ceilingGib} GiB (FLISK_BUILD_CACHE_MAX_GIB changes the limit, 0 turns it off).`));
    }
}
/** The container disk guard; a dry run skips it inside `guardDisk`. */
function upDiskGuard(run) {
    run.guardDisk(true);
}
/**
 * An unknown schemaVersion is refused before the machine check, so --json can name the file even when Bun is missing.
 * The discovery done here is reused by the container run below when nothing was cloned meanwhile.
 */
function upSchemaGate(run) {
    run.schemaRoot = findProjectRoot();
    if (run.schemaRoot) {
        try {
            run.initialDiscovery = discoverResourcesWithProblems(run.schemaRoot);
            warnAboutSkippedFiles(run.initialDiscovery.problems);
        }
        catch {
            // A root that cannot be read is reported by the checks that run next.
        }
        if (run.initialDiscovery) {
            enforceSchemaVersionGate(run.schemaRoot, {
                resources: run.initialDiscovery.resources,
                onInvalid: (message) => run.emit?.({ ok: false }, [upError("INVALID_SCHEMA_VERSION", message)]),
            });
        }
    }
}
/** Bun, Docker, git, disk space and the proxy env a container run needs; refused before Tilt is even asked. */
async function upMachinePreflight(run) {
    if (run.options.dryRun)
        return;
    const { assertMachineReadyOrExit } = await import("../utils/cold-preflight.js");
    await assertMachineReadyOrExit({ hints: upFailureHints({ kind: "machine" }) });
}
// ---- container-run steps: the Docker + Tilt path, run inside the Tilt availability check ----
/**
 * The container path itself: its `containerSteps` run inside the Tilt availability check (a dry run only needs the
 * plain command wrapper). Kept as a second pipeline so the shape is the same on both levels.
 */
async function upContainerRun(run) {
    const action = () => runUpSteps(run, containerSteps);
    if (run.options.dryRun) {
        await runCommand(action);
    }
    else {
        await withTiltCheck(action);
    }
}
/**
 * The project root, the foreign-owner refusal (#3961), and the gateway decision every later container step reads.
 * Another folder with this project's name that already has containers would see its containers replaced and share
 * their database volume, so the read-only check stops the run before anything below writes to the project.
 */
function containerProjectRoot(run) {
    run.foundRoot = run.options.dryRun ? requireProjectRoot() : findProjectRoot();
    run.projectRoot = run.foundRoot ?? process.cwd();
    if (run.foundRoot && !run.options.dryRun) {
        const ownName = projectNameAt(run.foundRoot);
        const refusal = ownName
            ? upOwnerRefusal(ownName, findForeignContainerOwners(ownName, recordableStacks(run.foundRoot), run.foundRoot))
            : undefined;
        if (refusal) {
            run.fail("PROJECT_NAME_IN_USE", refusal.message, refusal.suggestions);
        }
    }
    if (run.options.gateway === false)
        assertGatewayOptOutIsConfigured(run.foundRoot);
    // With the gateway off nothing publishes the routed URLs, so none is printed or smoke-checked.
    run.gatewayEnabled = isGatewayEnabled(run.projectRoot, run.options);
}
/**
 * The resource discovery the whole run works on: the schema gate's discovery is reused when nothing was cloned
 * meanwhile, and a cloned-in service.json gets the gate it missed.
 */
function containerDiscovery(run) {
    const discoveredResources = discoverResourcesStrict(run.foundRoot && run.foundRoot === run.schemaRoot && !run.hasClonedRepos
        ? run.initialDiscovery
        : undefined);
    run.resources = discoveredResources;
    // Services in a repository that was just cloned were not in the discovery the gate above checked.
    if (run.foundRoot && run.hasClonedRepos) {
        enforceSchemaVersionGate(run.foundRoot, {
            resources: discoveredResources,
            onInvalid: (message) => run.emit?.({ ok: false }, [upError("INVALID_SCHEMA_VERSION", message)]),
        });
    }
    if (!run.options.only || run.stackName) {
        run.stacks = discoverStacks(discoveredResources);
        run.stackNames = run.stacks.map((stack) => stack.name);
    }
    // A dry run does not clone, so a service in a declared repository that is not cloned yet is pending, not absent.
    run.pendingClone = isDryRun(run) ? missingDeclaredRepoDirs(run.foundRoot) : [];
    // A project with no resources has nothing to start. One refusal, shared by the selector path below
    // and the plain path at the bottom of this action (#4966): the drift and service-config gates run
    // between the two, so the selector path needs its own copy before it can call a name unknown.
    // A project that wraps its own Tiltfile (`orchestration.source === "tiltfile"`) still runs it, as before.
    run.noResources =
        discoveredResources.length === 0 &&
            run.pendingClone.length === 0 &&
            !isTiltfileOrchestration(run.projectRoot);
}
/**
 * Reject a bad request before anything below can write to the project (.env, runtime assets, .flisk/project.json):
 * an unknown --only service or an unknown stack.
 */
function containerSelectionArgs(run) {
    if (run.options.only) {
        // Against an empty project every --only name is unknown; the empty project is the
        // failure, not the name, so refuse with NO_RESOURCES before validating the selector.
        if (run.noResources)
            refuseNoResources(run);
        if (run.stackName && !stackExists(run.stackName, run.resources)) {
            const error = errorFactories.stackNotFound(run.stackName, run.stackNames);
            run.failError(error);
        }
        const candidates = run.stackName
            ? getResourcesForStack(run.stackName, run.resources)
            : run.resources;
        const unknown = findUnknownServices(run.options.only, candidates);
        if (unknown.length > 0 && run.pendingClone.length > 0) {
            if (!run.emit && !run.options.quiet) {
                console.warn(chalk.yellow(`Pending clone: ${unknown.join(", ")} may be in a repository not cloned yet (${run.pendingClone.join(", ")}). A real run clones it first.`));
            }
        }
        else if (unknown.length > 0) {
            const validNames = candidates.map((service) => service.name);
            const error = errorFactories.unknownServices(unknown, validNames);
            const suggestions = unknownServiceSuggestions(unknown, validNames, error.suggestions);
            run.emit?.({ ok: false }, [upError("UNKNOWN_SERVICE", error.message, suggestions)]);
            error.exit();
        }
    }
}
/** Also under --dry-run: the check only reads, and a dry run should show what a real run would refuse. */
function containerDriftGate(run) {
    if (run.foundRoot) {
        enforceDriftGate(run.foundRoot, {
            ignoreDrift: run.options.ignoreDrift,
            resources: run.resources,
            onDrift: (message) => run.emit?.({ ok: false }, [upError("DRIFT_DETECTED", message)]),
        });
    }
}
/** Duplicate names, circular dependsOn and invalid ports are refused before anything starts, dry run included. */
function containerServiceConfigGate(run) {
    if (run.foundRoot) {
        enforceServiceConfigGate(run.foundRoot, {
            resources: run.resources,
            onInvalid: (message) => run.emit?.({ ok: false }, [upError("INVALID_SERVICE_CONFIG", message)]),
            onWarning: (message) => run.projectWarnings.push(message),
        });
    }
}
/**
 * Warn about dependsOn/backendName targets nothing starts, and (human mode only) schema, secret and Model Runner
 * notes; the unknown names ride along in the dry-run result below.
 */
function containerDependencyWarnings(run) {
    // A dependsOn name that is no service, stack or shared Postgres is dropped by the Tiltfile; say so instead of starting without it.
    run.unknownDependsOn = run.foundRoot
        ? evaluateSharedPlatformPostgres(run.foundRoot, run.resources).unknownDependsOnNames
        : [];
    run.unknownBackends = run.foundRoot ? unknownBackendNames(run.resources) : [];
    if (run.unknownBackends.length > 0 && !run.emit && !run.options.quiet) {
        for (const { resource, name } of run.unknownBackends) {
            console.warn(chalk.yellow(`⚠️  ${resource} has backendName "${name}", which is not a service of this project; it has no backend to wait for or call.`));
        }
    }
    if (run.unknownDependsOn.length > 0 && !run.emit && !run.options.quiet) {
        for (const { resource, name } of run.unknownDependsOn) {
            console.warn(chalk.yellow(`⚠️  ${resource} dependsOn "${name}", which is not a service or stack of this project; it is ignored. Fix the name, or remove it.`));
        }
    }
    // A project without schemaVersion keeps working; say how to add it, but only where a person is reading.
    if (run.foundRoot && !run.emit && !run.options.quiet) {
        warnSchemaVersions(run.foundRoot, run.resources);
        warnSecretConflicts(run.foundRoot, run.resources);
        // A dry run starts nothing, so it does not ask Docker about Model Runner.
        if (!run.options.dryRun)
            warnModelRunner(run.foundRoot, run.resources);
    }
}
/**
 * A real start claims the host ports it picks, so a second project starting at the same moment moves to the next
 * port instead of choosing the same one. A dry run only reports and holds nothing.
 */
async function containerHostPortPlan(run) {
    const claimPort = run.options.dryRun ? undefined : createPortClaimer(run.projectRoot);
    run.claimPort = claimPort;
    // Read before the plan below is saved: a plan made afresh has no tiltUi and would erase the port this project's
    // running Tilt was started on (#4165).
    run.savedTiltPort = readSavedTiltPort(run.projectRoot);
    run.hostPortPlan = await getHostPortPlan(run.projectRoot, {
        inspectDocker: !run.options.dryRun,
        database: run.options.database,
        gateway: run.gatewayEnabled,
        ...(claimPort
            ? {
                isPortFree: async (port) => (await isHostPortAvailable(port)) && claimPort(port),
            }
            : {}),
    });
}
/**
 * The writes a real start performs: complete .env, generated secrets, capability opt-outs, generated-file
 * regeneration, runtime assets, .gitignore, stack phases. A dry run only reports.
 */
async function containerProjectWrites(run) {
    if (run.options.dryRun)
        return;
    // An older project's .env predates keys such as JWT_SECRET, which Compose now requires. Add what is missing (never
    // changing an existing value) before anything starts. Only inside a real project, so a stray run never writes a .env.
    // A selected env file replaces the project .env for this run: the run does not read it, so it is not completed either.
    if (run.foundRoot && !run.envFileSelection) {
        // A project of only bring-your-own containers that do not use the shared PostgreSQL needs no DB_PASSWORD (#3200).
        const addedEnvKeys = completeEnvFile(run.projectRoot, {
            databaseKeys: projectNeedsDatabaseKeys(run.projectRoot),
            verdaccio: projectConfigEnablesVerdaccio(run.projectRoot),
        });
        if (addedEnvKeys.length > 0 && !run.options.quiet) {
            console.log(chalk.gray(`Added ${addedEnvKeys.join(", ")} to .env (generated; existing values unchanged)`));
        }
        // A worktree copied from the main checkout keeps its generated DATABASE_URL; scope that one value to this
        // checkout before Tilt/Compose read it (#4698).
        if (scopeCheckoutEnvFile(run.projectRoot) && !run.options.quiet) {
            console.log(chalk.gray("Scoped the generated DATABASE_URL in .env to this checkout"));
        }
    }
    // Names in secrets.generate are appended to the .env once (#3140); the values are never printed.
    if (run.foundRoot && !run.envFileSelection) {
        const generatedNames = ensureGeneratedSecrets(run.projectRoot, run.resources);
        if (generatedNames.length > 0 && !run.options.quiet) {
            console.log(chalk.gray(`Generated ${generatedNames.join(", ")} into .env (once; existing values unchanged)`));
        }
    }
    // `--no-database` is saved in project.json and the generated files are rebuilt from it, so the flag also takes effect on a
    // project generated with Postgres, and the next `flisk up` and `flisk config verify` agree with this run.
    const databaseTurnedOff = Boolean(run.foundRoot) &&
        run.options.database === false &&
        disableDatabaseCapability(run.projectRoot);
    // A project made by `flisk import` has .flisk/project.json but no generated files yet. Generate them rather than letting
    // Tilt fail on a missing Tiltfile. After `flisk import tiltfile` the generated Tiltfile must be the wrapper that
    // includes the project's own one, so an older generated Tiltfile is replaced too (the user's Tiltfile is never written),
    // and a wrapper is replaced by the full Tiltfile once project.json no longer selects one.
    if (run.foundRoot && !existsSync(join(run.projectRoot, ".flisk", ".flisk-out", "Tiltfile"))) {
        if (!run.options.quiet) {
            console.log(chalk.gray("No generated Tiltfile yet; generating .flisk/.flisk-out/ ..."));
        }
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
    }
    else if (run.foundRoot && isWrappedTiltfileStale(run.projectRoot)) {
        // The capability opt-outs above are already saved, so this regeneration also honours them.
        if (!run.options.quiet) {
            console.log(chalk.gray(isTiltfileOrchestration(run.projectRoot)
                ? "Wrapping your Tiltfile; regenerating .flisk/.flisk-out/ ..."
                : "project.json no longer wraps a Tiltfile; regenerating .flisk/.flisk-out/ ..."));
        }
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
    }
    else if (run.foundRoot && isVendoredEngineStale(run.projectRoot)) {
        // After an upgrade (or a checkout on another commit) the vendored engine and the Tiltfile are the old ones, and a
        // running Tilt keeps loading them. Regenerating replaces both; a running Tilt reloads them on its own (#2899).
        if (!run.options.quiet) {
            console.log(chalk.gray("This Flisk ships a different engine or templates than .flisk/.flisk-out/ was generated with; regenerating ..."));
        }
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
    }
    else if (run.foundRoot && areMasterFilesStale(run.projectRoot)) {
        // The router and the shared Postgres follow the project's resources, so a resource added or removed since the last
        // run can change what spec.master starts (#2963).
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
    }
    else if (databaseTurnedOff || run.options.gateway === false) {
        // `--no-gateway` regenerates too: outputs generated before project.json turned the gateway off still start Traefik.
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
    }
    if (databaseTurnedOff && !run.options.quiet) {
        console.log(chalk.gray("Set capabilities.database to false in .flisk/project.json; regenerated .flisk/.flisk-out/ without the shared Postgres"));
    }
    if (run.foundRoot && !isDatabaseCapabilityEnabled(run.projectRoot)) {
        // The Tiltfile still force-starts the shared Postgres for a dependsOn on it (or for a database resource), so say so
        // rather than look ignored.
        const databaseNames = databaseResourceNames(run.resources);
        const postgresUsers = run.resources
            .filter((r) => databaseNames.includes(r.name) ||
            dependsOnOf(r.config).some((name) => namesSharedPlatformPostgres(name, databaseNames)))
            .map((r) => r.name);
        if (postgresUsers.length > 0 && !run.options.quiet) {
            console.warn(chalk.yellow(`Database capability is off, but ${postgresUsers.join(", ")} depend on postgres; the shared Postgres still starts for them.`));
        }
    }
    const copiedAssets = ensureProjectRuntimeAssets(run.projectRoot);
    const ignoredGenerated = run.foundRoot ? ensureGeneratedRootIgnored(run.projectRoot) : [];
    if (ignoredGenerated.length > 0 && !run.options.quiet) {
        console.log(chalk.gray(`Added to .gitignore (generated, not yours to commit): ${ignoredGenerated.join(", ")}`));
    }
    if (copiedAssets.length > 0 && run.options.verbose && !run.options.quiet) {
        console.log(chalk.gray(`Refreshed runtime assets: ${copiedAssets.join(", ")}`));
    }
    const newlyEnabledStacks = enableDiscoveredStacks(run.projectRoot, run.resources);
    if (newlyEnabledStacks.length > 0) {
        // project.json just changed, so the generated spec.master is now stale. Regenerate it here, or the next
        // `flisk config verify` reports it out of sync.
        await generateMasterConfigs(run.projectRoot, { quiet: run.options.quiet });
        if (!run.options.quiet) {
            console.log(chalk.gray(`Added ${newlyEnabledStacks.join(", ")} to the pre_alpha phase in .flisk/project.json`));
        }
    }
}
/**
 * What `flisk up` starts: the stack selection, the --only expansion with its dependencies, and the profile filter.
 * The empty-project refusal happens here too, before Tilt starts Traefik and Postgres for nothing (#3781).
 */
function containerServiceSelection(run) {
    let servicesToStart;
    let stackDescription;
    let focusServiceNames = [];
    if (run.stackName) {
        servicesToStart = getResourcesForStack(run.stackName, run.resources);
        if (servicesToStart.length === 0) {
            const error = errorFactories.stackNotFound(run.stackName, run.stackNames);
            run.failError(error);
        }
        focusServiceNames = servicesToStart.map((s) => s.name);
        stackDescription = `stack "${run.stackName}"`;
    }
    else {
        servicesToStart = run.resources;
        const allStacks = run.stacks ?? discoverStacks(run.resources);
        stackDescription = `all stacks (${formatCount(allStacks.length, "stack")}, ${formatCount(servicesToStart.length, "service")})`;
    }
    let dependencyNames = [];
    if (run.options.only) {
        // Dependencies come from the whole project, not just the named stack: dependsOn may cross stacks.
        const selection = resolveOnlySelection(run.options.only, run.resources);
        servicesToStart = selection.selected;
        dependencyNames = selection.dependencies;
        focusServiceNames = servicesToStart.map((s) => s.name);
        stackDescription = `${formatCount(run.options.only.length, "requested service")}${dependencyNames.length > 0 ? ` plus ${dependencyNames.join(", ")}` : ""}`;
    }
    // Services in a profile that was not asked for are left out (#2873); Tilt then gets the remaining names, not whole stacks.
    assertKnownProfiles(run.options.profile, run.resources, run.emit);
    const profileSelection = applyProfiles(servicesToStart, run.options.profile ?? [], run.options.only ?? []);
    run.profileSelection = profileSelection;
    if (profileSelection.skipped.length > 0) {
        servicesToStart = profileSelection.kept;
        focusServiceNames = servicesToStart.map((s) => s.name);
        if (!run.options.quiet)
            console.log(chalk.gray(skippedProfilesNote(profileSelection.skipped)));
    }
    if (run.options.verbose && !run.options.quiet) {
        console.log(chalk.gray(`Found ${formatCount(servicesToStart.length, "service")} in ${stackDescription}`));
    }
    run.servicesToStart = servicesToStart;
    run.dependencyNames = dependencyNames;
    run.focusServiceNames = focusServiceNames;
    run.stackDescription = stackDescription;
    run.serviceNames = servicesToStart.map((s) => s.name);
    // A project with no resources has nothing to start. Refuse before Tilt, so `flisk project --yes && flisk up`
    // does not start Traefik, Postgres and the gateway for an empty stack (#3781). The --only path already
    // refused above; a dry run with a repository still pending clone reaches the pending-clone warning instead.
    if (run.noResources)
        refuseNoResources(run);
}
/**
 * The checkout-host claim, then the "Starting N services" banner with the routed frontend/backend URLs, the
 * `tilt up` argument list, the host-port plan readout, and the dry-run literal-ports warning.
 */
async function containerStartupPlan(run) {
    const { options } = run;
    const hostPortPlan = run.hostPortPlan;
    // Resolve the checkout host before printing URLs so a suffixed host is the one users see. A dry run does not
    // start a stack (and does not persist checkout state), so it only honours an already-recorded suffix.
    run.checkoutIdentity = options.dryRun ? null : exportCheckoutEnv(run.projectRoot);
    run.hostSuffix = run.checkoutIdentity
        ? await claimCheckoutHost(run.projectRoot, run.checkoutIdentity, listTiltInstances().map((instance) => instance.root))
        : null;
    if (run.hostSuffix && run.checkoutIdentity && !options.quiet) {
        console.log(chalk.yellow(`??  Another stack uses checkout name ${run.checkoutIdentity.name}; this one uses ${run.checkoutIdentity.name}${run.hostSuffix}.`));
    }
    if (!options.quiet) {
        console.log(chalk.blue(`${options.dryRun ? "Would start" : "Starting"} ${formatCount(run.serviceNames.length, "service")} from ${run.stackDescription}...`));
        for (const name of run.serviceNames) {
            console.log(chalk.gray(`  - ${name}`));
        }
        const { appBase, apiBase } = resolveSubdomainBases(hostPortPlan.ingressHttp, run.projectRoot);
        const routed = run.gatewayEnabled ? run.servicesToStart.filter(isRoutableService) : [];
        const frontends = routed.filter((s) => s.config?.appType === "frontend" || isWebUiBringYourOwn(s));
        const backends = routed.filter((s) => routesAsApi(s));
        if (frontends.length > 0) {
            console.log(chalk.blue("\n🌍 Frontend URLs:"));
            for (const svc of frontends) {
                if (isWebUiBringYourOwn(svc)) {
                    const url = resolveServiceUrl(svc, hostPortPlan.ingressHttp);
                    console.log(chalk.gray(`  - ${svc.name}: ${chalk.cyan(url)}`));
                }
                else {
                    const basePath = svc.config?.basePath ?? `/${svc.name}`;
                    console.log(chalk.gray(`  - ${svc.name}: ${appBase}${chalk.cyan(basePath)}`));
                }
            }
        }
        if (backends.length > 0) {
            console.log(chalk.blue("\n🔧 Backend API URLs:"));
            for (const svc of backends) {
                const sablier = svc.config?.sablier;
                const deferredTag = sablier?.enable && sablier?.deferStart
                    ? chalk.dim(" (deferred — starts on first request)")
                    : "";
                if (isRoutedBringYourOwn(svc)) {
                    const url = resolveServiceUrl(svc, hostPortPlan.ingressHttp);
                    console.log(chalk.gray(`  - ${svc.name}: ${chalk.cyan(url)}${deferredTag}`));
                }
                else {
                    const servicePathName = svc.name.replace(/-api$/, "");
                    const apiPath = svc.config?.apiPath ?? `/api/${servicePathName}`;
                    console.log(chalk.gray(`  - ${svc.name}: ${apiBase}${chalk.cyan(appendHealthPath(apiPath))}${deferredTag}`));
                }
            }
        }
    }
    const profileSelection = run.profileSelection;
    const focusTargets = options.only ??
        (profileSelection.skipped.length > 0
            ? run.focusServiceNames
            : run.stackName
                ? [run.stackName]
                : undefined);
    run.tiltArgs = buildTiltUpArgs(run.focusServiceNames, {
        verbose: options.verbose,
        quiet: options.quiet,
        force: options.force,
        focusTargets,
    });
    run.dryRunCommand = focusTargets ? `tilt up ${run.tiltArgs.join(" ")}` : "tilt up";
    if (options.dryRun) {
        const literalPortsCheck = checkLiteralPorts(run.projectRoot, run.resources);
        if (!literalPortsCheck.didPass) {
            run.projectWarnings.push(literalPortsCheck.message);
            if (!options.quiet) {
                console.warn(chalk.yellow(`⚠️  Literal ports: ${literalPortsCheck.message}`));
            }
        }
    }
    if (!options.quiet) {
        console.log(chalk.blue(formatHostPortPlan(hostPortPlan)));
        for (const line of formatPortFallbackNotice(hostPortPlan))
            console.log(chalk.yellow(line));
        console.log(chalk.gray("Override with FLISK_HTTP_PORT, FLISK_HTTPS_PORT, or FLISK_POSTGRES_PORT."));
    }
}
/** The dry run's result: the --json envelope or the human plan, then the run is done. */
function containerDryRun(run) {
    if (run.emit && run.options.dryRun) {
        run.emit({
            ok: true,
            dryRun: true,
            stack: run.stackName ?? null,
            services: run.serviceNames,
            ...(run.options.only
                ? { requested: run.options.only, declaredDependencies: run.dependencyNames }
                : {}),
            ...(run.unknownDependsOn.length > 0 ? { unknownDependsOn: run.unknownDependsOn } : {}),
            ...(run.unknownBackends.length > 0 ? { unknownBackendNames: run.unknownBackends } : {}),
            command: run.dryRunCommand,
        });
        run.didFinish = true;
        return;
    }
    if (handleDryRun(run.options, "not starting services", run.dryRunCommand)) {
        run.didFinish = true;
    }
}
/**
 * Where this run's Tilt may already listen: the watched ports, the saved port and the foreign/unknown-owner
 * refusals, then the second-up decision (attach, block --only, or start).
 */
async function containerTiltPortScan(run) {
    const { options } = run;
    const hostPortPlan = run.hostPortPlan;
    exportHostPortPlan(hostPortPlan);
    // `exportCheckoutEnv` has already persisted the checkout id by now; refuse a linked worktree that could not
    // write its record, or the engine would fall back to the main checkout's database names (#4698).
    assertCheckoutIdentityPersisted(run.projectRoot);
    if (run.checkoutIdentity) {
        // Starlark reads this when it builds Traefik host rules, so a worktree's
        // routes match the checkout-specific URLs this command prints (#4697).
        exportCheckoutHostEnv(run.projectRoot);
    }
    const basePort = STANDARD_PORTS.tiltUi;
    run.watchedPort = run.configuredTiltPort ?? basePort;
    run.candidatePorts = options.only ? [...new Set([basePort, run.watchedPort])] : [run.watchedPort];
    run.tiltScan = await findProjectTiltPorts({
        watchedPorts: run.candidatePorts,
        savedPort: run.savedTiltPort,
        projectRoot: run.projectRoot,
        isServing: async (candidate) => (await tiltGetUiResources(candidate)) !== null,
    });
    const { running, foreign, unknownSaved } = run.tiltScan;
    if (foreign.length > 0 && run.configuredTiltPort !== undefined) {
        const other = foreign[0];
        const message = `TILT_PORT=${other?.port} is used by another project's Tilt (${other?.root}). Choose a free port, or run flisk down in that project.`;
        return run.fail("TILT_PORT_IN_USE", message);
    }
    if (!options.quiet) {
        for (const other of foreign) {
            console.log(chalk.yellow(`⚠️  Tilt on port ${other.port} belongs to another project (${other.root}); this project will use another port.`));
        }
    }
    if (options.force && unknownSaved.length > 0) {
        const message = `Tilt on saved port ${unknownSaved.join(", ")} cannot be identified as this project's, so --force will not stop it and will not start a second Tilt beside it. Run flisk down, or stop that Tilt yourself, then run flisk up again.`;
        return run.fail("TILT_OWNER_UNKNOWN", message);
    }
    // --force replaces this project's Tilt; it must never stop another project's. `running` holds only this project's
    // Tilt, so --force replaces it even when another project holds the base port.
    run.force = Boolean(options.force) && foreign.length === 0;
    run.decision = secondUpAction({
        runningPorts: running,
        force: Boolean(options.force),
        only: Boolean(options.only),
    });
}
/**
 * Attach to the Tilt this project already runs: --env-file is refused, --json waits for real readiness and reports
 * it (a Tilt a failed `flisk up` left running is a failure, not "healthy"), and the human path takes one snapshot.
 */
async function containerAttachRunning(run) {
    const decision = run.decision;
    if (decision.action === "already-running") {
        const { options } = run;
        const hostPortPlan = run.hostPortPlan;
        const emit = run.emit;
        // The env file of the run belongs to the Tilt process this run starts. A stack that is
        // already running keeps the env file it started with, so the selection would be ignored
        // silently - say so instead of reporting a run that never happened.
        if (run.envFileSelection) {
            const message = `A Tilt is already running on port ${decision.ports.join(", ")}. --env-file applies to a new run only: run \`flisk down\` first, or pass --force to replace the running stack.`;
            run.fail("ENV_FILE_ALREADY_RUNNING", message);
        }
        const runningPort = decision.ports[0] ?? run.watchedPort;
        const tiltUrl = `http://localhost:${runningPort}`;
        const parsedWaitTimeout = emit && typeof options.waitTimeout !== "undefined"
            ? parseWaitTimeout(options.waitTimeout)
            : undefined;
        if (emit && parsedWaitTimeout && !parsedWaitTimeout.ok) {
            const suggestions = ["--wait-timeout 600"];
            emit({ ok: false }, [
                upError("INVALID_WAIT_TIMEOUT", parsedWaitTimeout.message, suggestions),
            ]);
            showErrorAndExit(parsedWaitTimeout.message, 2, suggestions);
        }
        // Keep the running Tilt's port saved once refusal checks pass, so the next `flisk up` (and status, logs, restart) finds it again.
        hostPortPlan.tiltUi = runningPort;
        writeSavedHostPortPlan(run.projectRoot, hostPortPlan);
        const deferred = getDeferredResourceNames(run.resources);
        if (emit) {
            // `ok` means the stack is healthy (`flisk up --wait` prints "Stack is healthy" from it), so wait for the running
            // stack as a first run would. A Tilt left by a failed `flisk up` answers on its port with every service in error.
            const dependsOn = Object.fromEntries(run.resources.map((r) => [r.name, dependsOnOf(r.config)]));
            const readiness = await waitForTiltResourcesReady(runningPort, {
                timeoutMs: parsedWaitTimeout?.ok ? parsedWaitTimeout.seconds * 1000 : undefined,
                deferred,
                disabledHealth: getDisabledHealthResourceNames(run.resources),
                optionalHealth: getOptionalHealthResourceNames(run.resources),
                isStalled: (text) => isStartupStalled(text, dependsOn, deferred),
            });
            const failures = withHealthProbeDetails(withUpFailureCodes(readiness.ready
                ? readiness.failures
                : await explainReadinessFailures(readiness.failures, (name) => tiltResourceLogs(runningPort, name))));
            const report = alreadyRunningReport(runningPort, { ...readiness, failures });
            if (report.ok) {
                for (const opt of readiness.optionalFailures ?? []) {
                    run.projectWarnings.push(`${opt.name} (optional health check): ${opt.message}`);
                }
                let attachedUrlChecks = [];
                if (run.gatewayEnabled) {
                    const urlChecks = await checkStackUrls(runningPort, run.servicesToStart, hostPortPlan.ingressHttp, deferred);
                    if (urlChecks.some((check) => !check.didAnswer)) {
                        clearFastNoopState(run.projectRoot);
                        emit({ ok: false, alreadyRunning: true, tiltUrl, urls: urlChecks }, [
                            upError("UP_URL_UNREACHABLE", `${formatUrlFailures(urlChecks).join("\n")}\nTilt is still running; inspect it or run: flisk down`, urlFailureSuggestions(urlChecks)),
                        ]);
                        process.exitCode = 1;
                        run.didFinish = true;
                        return;
                    }
                    attachedUrlChecks = urlChecks;
                }
                // This run attached to a Tilt it did not start, so it saves no fast-path state (#4193): the Tilt may hold an
                // env file this run's fingerprint does not describe. A fresh healthy start records the state instead.
                const urls = recordHealthyRun({
                    projectRoot: run.projectRoot,
                    flags: run.fastFlags,
                    tiltPort: runningPort,
                    stack: run.stackName ?? null,
                    resources: run.servicesToStart,
                    ingressPort: hostPortPlan.ingressHttp,
                    gatewayEnabled: run.gatewayEnabled,
                    persist: false,
                });
                emit({
                    ok: true,
                    alreadyRunning: true,
                    tiltUrl,
                    ...(urls.length > 0 ? { advertisedUrls: urls } : {}),
                    ...(attachedUrlChecks.length > 0 ? { urls: attachedUrlChecks } : {}),
                });
            }
            else {
                clearFastNoopState(run.projectRoot);
                emit({ ok: false, alreadyRunning: true, tiltUrl, failures }, [
                    upError(report.code, report.message, report.suggestions),
                ]);
                process.exitCode = 1;
            }
            run.didFinish = true;
            return;
        }
        // Attached: one look is enough. A stack that is still building is running; one with a failed resource is not.
        const snapshot = await tiltGetUiResources(runningPort);
        // The same health filters as the --json wait, so a service with its health check disabled, or whose probe cannot run,
        // does not fail the attached run while --json calls the stack healthy.
        const current = snapshot
            ? evaluateTiltReadiness(snapshot, deferred, undefined, getDisabledHealthResourceNames(run.resources), healthProbeCannotRun, getOptionalHealthResourceNames(run.resources)).result
            : undefined;
        if (current && current.failures.length > 0) {
            const report = alreadyRunningReport(runningPort, current);
            if (!report.ok)
                showErrorAndExit(report.message, 1, report.suggestions);
        }
        if (!options.quiet) {
            console.log(chalk.green(`Environment is already running on port ${decision.ports.join(", ")}.`));
            for (const opt of current?.optionalFailures ?? []) {
                console.log(chalk.yellow(`Warning: ${opt.name} (optional health check): ${opt.message}`));
            }
            console.log(`Tilt UI: ${tiltUrl}`);
        }
        run.didFinish = true;
    }
}
/** A running Tilt's services are its own: --only cannot re-select them beside it. */
function containerOnlyBlocked(run) {
    if (run.decision?.action === "only-blocked") {
        const message = `A Tilt is already running on port ${run.decision.ports.join(", ")}. --only cannot change a running stack's services: run \`flisk down\` first, or pass --force to replace it.`;
        run.fail("TILT_ALREADY_RUNNING", message);
    }
}
/**
 * Pick this run's Tilt port, claim it in the saved plan and stop the Tilt this run replaces; a --force that leaves a
 * saved Tilt serving is refused rather than starting a second controller for one Tiltfile (#4165).
 */
async function containerResolveTiltPort(run) {
    const { options } = run;
    const hostPortPlan = run.hostPortPlan;
    const tiltScan = run.tiltScan;
    const { running, savedRunning } = tiltScan;
    const basePort = STANDARD_PORTS.tiltUi;
    // Past the attach and refusal paths this run starts or replaces Tilt, so the collision suffix becomes the
    // checkout's recorded host only now: a refusal must leave a running stack's recorded host alone.
    if (run.hostSuffix)
        setCheckoutHostSuffix(run.projectRoot, run.hostSuffix);
    if (options.only && run.force) {
        for (const runningPort of running) {
            if (run.candidatePorts.includes(runningPort))
                stopTiltOnPort(runningPort);
        }
    }
    // Only force-claim `basePort` without probing when `basePort` is held by a Tilt we are replacing; otherwise a
    // non-Tilt service on `basePort` would cause `--force` to stop `savedRunning` and then fail binding `basePort`.
    const canReplaceTargetPort = Boolean(run.force) && (run.configuredTiltPort !== undefined || running.includes(basePort));
    const resolution = await resolveTiltPort({
        configuredPort: run.configuredTiltPort,
        force: canReplaceTargetPort,
        basePort,
        findAvailablePort: (base, attempts) => findAvailablePort(base, attempts, run.claimPort),
        fallbackPort: savedRunning[0],
    });
    const port = resolution.port;
    run.tiltPort = port;
    if (resolution.autoSwitched && !options.quiet) {
        console.log(chalk.yellow(`⚠️  Port ${basePort} is already in use`));
        console.log(chalk.blue(`🔄 Auto-switching to port ${port}\n`));
    }
    process.env.TILT_PORT = port.toString();
    hostPortPlan.tiltUi = port;
    writeSavedHostPortPlan(run.projectRoot, hostPortPlan);
    await stopTiltForUp({
        force: canReplaceTargetPort,
        quiet: options.quiet,
        port,
        ownPorts: options.force ? savedRunning : [],
    }, {
        stop: (targetPort) => {
            if (savedRunning.includes(targetPort)) {
                stopOwnedTiltOnPort(targetPort, run.projectRoot);
            }
            else {
                stopTiltOnPort(targetPort);
            }
        },
        log: (message) => console.log(chalk.yellow(message)),
        wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
    // stopOwnedTiltOnPort refuses (returns nothing) when the listener changed owner since discovery, and [] also means
    // "nothing was listening", so judge by the port: a saved Tilt still serving means it was not stopped, and starting
    // another would run two controllers for one Tiltfile (#4165).
    if (options.force && savedRunning.length > 0) {
        const stillServing = await waitForTiltPortsToStop(savedRunning, (candidate) => tiltGetUiResources(candidate).then((resources) => resources !== null));
        if (stillServing.length > 0) {
            const message = `Tilt on port ${stillServing.join(", ")} is still running after --force tried to stop it, so flisk up did not start a second Tilt. Run flisk down, then run flisk up again.`;
            return run.fail("TILT_STOP_FAILED", message);
        }
    }
}
/**
 * A cold start (no images yet, no build cache) can take minutes where a warm one takes seconds; say so once, so a
 * slow first run does not look stuck (#3201). Under --json it goes to stderr: stdout carries the envelope only.
 */
async function containerColdNotice(run) {
    const coldNotice = await upColdStartNotice(run.projectRoot, run.servicesToStart);
    if (coldNotice) {
        if (run.options.json)
            console.warn(coldNotice);
        else if (!run.options.quiet)
            console.log(chalk.cyan(`\n${coldNotice}`));
    }
}
/** Pull the models services declare before `tilt up` asks Docker Model Runner for them. */
async function containerModelPreflight(run) {
    const { options } = run;
    if (!options.dryRun) {
        const requiredModels = collectRequiredModels(run.servicesToStart);
        if (requiredModels.length > 0) {
            if (!options.quiet) {
                console.log(chalk.gray(`Checking required models with Docker Model Runner (${requiredModels.join(", ")})...`));
            }
            const preflightResult = await runModelPreflight(requiredModels, {
                onRetry: options.quiet
                    ? undefined
                    : ({ model, attempt, maxAttempts, delayMs, error }) => {
                        console.log(chalk.yellow(`Retrying model pull for ${model} (attempt ${attempt}/${maxAttempts}) in ${delayMs / 1000}s: ${error}`));
                    },
            });
            if (!preflightResult.ok) {
                const message = `Failed to pull required model "${preflightResult.failedModel}" after ${preflightResult.attempts} attempts: ${preflightResult.error}`;
                const suggestions = [
                    `Docker Model Runner failed to pull: ${preflightResult.failedModel}`,
                    preflightResult.error,
                    "Verify Docker Model Runner is active and reachable, or pull the model manually.",
                ];
                return run.fail("MODEL_PULL_FAILED", message, suggestions);
            }
        }
    }
}
/**
 * Spawn `tilt up`, then race its exit against the startup report: a readiness failure signals `startupFailure` so
 * the command exits 1 at once instead of waiting for a Tilt that keeps running (`flisk down` stops it).
 */
async function containerTiltUp(run) {
    const { options } = run;
    const hostPortPlan = run.hostPortPlan;
    if (!options.quiet) {
        console.log(chalk.gray("\nRunning tilt up..."));
        console.log(chalk.gray(`Using Tiltfile: .flisk/.flisk-out/Tiltfile`));
    }
    // Remember where this project lives, so `flisk projects --stale` can tell its Docker volumes apart from a stopped
    // project's once the folder is deleted (Docker records no folder on a volume).
    recordProjectRoot(run.projectRoot, { stacks: recordableStacks(run.projectRoot) });
    // Record the shared-Postgres databases this run uses, so `flisk doctor` can compare the names running
    // checkouts actually claim rather than the names a fresh `flisk up` would derive (#5132).
    writeRunDatabases(run.projectRoot, runDatabaseUses(run.projectRoot, run.servicesToStart));
    const tiltRun = runTilt("up", run.tiltArgs, {
        verbose: options.verbose && !options.json,
        quiet: options.quiet,
        inheritStdio: !options.quiet, // Suppress tilt output in quiet mode
    });
    // Services that declare `smoke` are checked through the public URL once Tilt is up. A miss stops Tilt (containers stay for
    // inspection; `flisk down` removes them) and fails the command.
    run.smokePlans = buildSmokePlans(run.servicesToStart, hostPortPlan.ingressHttp, {
        gateway: run.gatewayEnabled,
    });
    run.startupFailure = new Promise((resolve) => {
        run.signalStartupFailed = resolve;
    });
    const successOutput = reportStartup(run);
    const result = await waitForTiltUnlessStartupFailed(tiltRun, run.startupFailure);
    await successOutput;
    if (run.smokeFailed) {
        process.exit(1);
    }
    if (result.exitCode !== 0) {
        showErrorAndExit(`tilt up failed with exit code ${result.exitCode}`, result.exitCode, upFailureHints({ kind: "tilt-exited" }));
    }
    if (run.startupFailed && result.exitCode === 0) {
        process.exit(1);
    }
    if (!options.quiet && result.exitCode === 0 && !run.printedSuccess) {
        await printReadinessSuccess(run);
    }
}
// ---- startup report steps: the concurrent half of `tilt-up`, in order ----
/**
 * Prints the "ready" service table once resources report running; used by the streaming success path and by the
 * post-Tilt fallback when that path did not print.
 */
async function printReadinessSuccess(run) {
    const port = run.tiltPort;
    const hostPortPlan = run.hostPortPlan;
    const deferred = getDeferredResourceNames(run.resources);
    const dependsOn = Object.fromEntries(run.resources.map((r) => [r.name, dependsOnOf(r.config)]));
    const readiness = await waitForTiltResourcesReady(port, {
        deferred,
        disabledHealth: getDisabledHealthResourceNames(run.resources),
        optionalHealth: getOptionalHealthResourceNames(run.resources),
        isStalled: (text) => isStartupStalled(text, dependsOn, deferred),
    });
    const optionalFailed = new Set((readiness.optionalFailures ?? []).map((f) => f.name));
    const serviceHealth = readiness.enabled.map((name) => {
        const failed = readiness.failures.find((f) => f.name === name);
        const isOptionalFailed = optionalFailed.has(name);
        const svc = run.resources.find((r) => r.name === name);
        const isReady = !failed && !isOptionalFailed;
        const isStarting = !isReady && !failed && !isOptionalFailed;
        const url = svc && run.gatewayEnabled ? resolveServiceUrl(svc, hostPortPlan.ingressHttp) : undefined;
        return {
            name,
            status: failed || isOptionalFailed ? "failed" : isStarting ? "starting" : "ready",
            ...(isOptionalFailed ? { optional: true } : {}),
            url,
            ...(svc && url ? { healthUrl: printedHealthUrl(svc, url) } : {}),
        };
    });
    for (const line of formatUpSuccess(port, {
        serviceHealth,
        showLogsHint: true,
    }))
        console.log(chalk.blue(line));
    for (const opt of readiness.optionalFailures ?? []) {
        console.log(chalk.yellow(`Warning: ${opt.name} (optional health check): ${opt.message}`));
    }
}
/**
 * The Tilt UI port answering only means Tilt started; the steps after this one report what "ready" means. The
 * report's verdict fields are reset here, like the IIFE locals this replaces.
 */
async function startupWaitUi(run) {
    run.uiReady = await waitForTiltUi(run.tiltPort);
    // JSON consumers get success only after every non-deferred resource is built and running, not when the UI port opens.
    run.jsonReady = false;
    run.startedServices = run.serviceNames;
    run.startedDependencies = run.dependencyNames;
    run.urlChecks = undefined;
}
/** The --json readiness wait and the failure/URL verdict emitted on it. */
async function startupJsonReadiness(run) {
    const emit = run.emit;
    if (!emit)
        return;
    const port = run.tiltPort;
    const deferred = getDeferredResourceNames(run.resources);
    const dependsOn = Object.fromEntries(run.resources.map((r) => [r.name, dependsOnOf(r.config)]));
    const parsedWaitTimeout = typeof run.options.waitTimeout !== "undefined"
        ? parseWaitTimeout(run.options.waitTimeout)
        : undefined;
    const waitTimeoutMs = parsedWaitTimeout?.ok ? parsedWaitTimeout.seconds * 1000 : undefined;
    const readiness = await waitForTiltResourcesReady(port, {
        timeoutMs: waitTimeoutMs,
        deferred,
        disabledHealth: getDisabledHealthResourceNames(run.resources),
        optionalHealth: getOptionalHealthResourceNames(run.resources),
        // Only what the caller named must be enabled. Dependencies are the Tiltfile's call (it skips some on purpose).
        expected: run.options.only
            ? run.options.only.filter((name) => !deferred.has(name))
            : undefined,
        // As for the human output: stop as soon as everything left is blocked by a failure (for example init-networks),
        // instead of waiting out the whole timeout.
        isStalled: (text) => isStartupStalled(text, dependsOn, deferred),
    });
    if (readiness.ready) {
        run.jsonReady = true;
        for (const opt of readiness.optionalFailures ?? []) {
            run.projectWarnings.push(`${opt.name} (optional health check): ${opt.message}`);
        }
        if (run.options.only) {
            // Report what Tilt actually enabled, not the service.json closure, which can differ from the Tiltfile's expansion.
            const enabled = new Set(readiness.enabled);
            const allNames = run.resources.map((r) => r.name);
            run.startedServices = allNames.filter((name) => enabled.has(name));
            run.startedDependencies = run.startedServices.filter((name) => !run.options.only.includes(name));
        }
        if (run.gatewayEnabled) {
            const started = new Set(run.startedServices);
            run.urlChecks = await checkStackUrls(port, run.resources.filter((r) => started.has(r.name)), run.hostPortPlan.ingressHttp, deferred);
            if (run.urlChecks.some((check) => !check.didAnswer)) {
                run.jsonReady = false;
                run.startupFailed = true;
                emit({ ok: false, tiltUrl: `http://localhost:${port}`, urls: run.urlChecks }, [
                    upError("UP_URL_UNREACHABLE", `${formatUrlFailures(run.urlChecks).join("\n")}\nTilt is still running; inspect it or run: flisk down`, urlFailureSuggestions(run.urlChecks)),
                ]);
            }
        }
        if (run.jsonReady) {
            // Per-service start-to-ready times for benchmarks (#4129): read once from Tilt's own resource history.
            const uiJson = await tiltGetUiResources(port);
            run.timings = uiJson ? serviceTimings(uiJson, run.startedServices) : undefined;
        }
    }
    else {
        run.startupFailed = true;
        const failures = withHealthProbeDetails(withUpFailureCodes(await explainReadinessFailures(readiness.failures, (name) => tiltResourceLogs(port, name), (conflictedPort) => findPortContainer(conflictedPort) ?? findPortOccupant(conflictedPort))));
        const detail = formatFailureDetail(failures);
        const stillBuildingMsg = readiness.stillBuilding && readiness.stillBuilding.length > 0
            ? ` (${readiness.stillBuilding.join(", ")} still building)`
            : "";
        // The build's `ERROR:` line is the last line of a non-timeout failure: repeating six shell templates or
        // hiding the reason behind "inspect Tilt" sent the demo user in the wrong direction (#3958).
        const message = readiness.timedOut
            ? `Timed out waiting for resources${stillBuildingMsg}${detail ? ` (${detail})` : ""}. Tilt is still running; inspect it or run: flisk down`
            : `Resources failed. Tilt is still running; inspect it or run: flisk down${detail ? `\n${detail}` : ""}`;
        emit({ ok: false, tiltUrl: `http://localhost:${port}`, failures }, [
            upError(readiness.timedOut ? "UP_TIMEOUT" : "UP_RESOURCE_FAILED", message, [
                ...upFailureHints({
                    kind: "services",
                    failed: readiness.failures.map((failure) => failure.name),
                    timedOut: readiness.timedOut,
                    stillBuilding: readiness.stillBuilding,
                    tiltPort: port,
                }),
                ...portConflictHints(failures),
            ]),
        ]);
    }
}
/**
 * The human readiness wait: the progress reporter, the formatted startup report on failure, and the URL check
 * that still has to pass before "ready" is printed.
 */
async function startupHumanReadiness(run) {
    const { options } = run;
    const port = run.tiltPort;
    const deferred = getDeferredResourceNames(run.resources);
    const dependsOn = Object.fromEntries(run.resources.map((r) => [r.name, dependsOnOf(r.config)]));
    const progress = createUpProgressReporter({
        write: (text) => process.stdout.write(text),
        redraw: shouldRedrawUpProgress({
            isTTY: process.stdout.isTTY,
            quiet: Boolean(options.quiet),
            env: process.env,
        }),
        deferred,
        columns: process.stdout.columns,
    });
    const parsedWaitTimeout = typeof options.waitTimeout !== "undefined" ? parseWaitTimeout(options.waitTimeout) : undefined;
    const waitTimeoutMs = parsedWaitTimeout?.ok ? parsedWaitTimeout.seconds * 1000 : undefined;
    const readiness = await waitForTiltResourcesReady(port, {
        timeoutMs: waitTimeoutMs,
        deferred,
        disabledHealth: getDisabledHealthResourceNames(run.resources),
        optionalHealth: getOptionalHealthResourceNames(run.resources),
        isStalled: (text) => isStartupStalled(text, dependsOn, deferred),
        fetchJson: fetchWithProgress(tiltGetUiResources, progress),
    });
    progress.finish();
    if (!readiness.ready) {
        run.startupFailed = true;
        const resourcesJson = await tiltGetUiResources(port);
        const report = resourcesJson
            ? buildStartupReport(resourcesJson, dependsOn, deferred)
            : {
                failed: readiness.failures.map((failure) => ({
                    name: failure.name,
                    message: summarizeTiltBuildError(failure.message),
                })),
                blocked: [],
                starting: [],
                stillBuilding: readiness.stillBuilding,
            };
        if (readiness.stillBuilding && readiness.stillBuilding.length > 0) {
            report.stillBuilding = readiness.stillBuilding;
        }
        report.failed = withHealthProbeDetails(await withLoggedReasons(report.failed, (name) => tiltResourceLogs(port, name)));
        const machineFixes = await machineProblemFixes(report.failed, (name) => tiltResourceLogs(port, name));
        const reportLines = formatStartupReport(report, readiness.timedOut, (port) => findPortContainer(port) ?? findPortOccupant(port), machineFixes, readiness.lastLogs);
        if (reportLines.length > 0) {
            showError(reportLines.join("\n"), undefined, [
                ...upFailureHints({
                    kind: "services",
                    failed: report.failed.map((failure) => failure.name),
                    timedOut: readiness.timedOut,
                    stillBuilding: readiness.stillBuilding,
                    tiltPort: port,
                }),
                ...portConflictHints(report.failed),
            ]);
        }
    }
    else if (run.gatewayEnabled) {
        // Every resource is running; "ready" still waits until each URL printed below answers.
        const checks = await checkStackUrls(port, run.servicesToStart, run.hostPortPlan.ingressHttp, deferred);
        const failureLines = formatUrlFailures(checks);
        if (failureLines.length > 0) {
            run.startupFailed = true;
            showError(failureLines.join("\n"), undefined, urlFailureSuggestions(checks));
        }
    }
}
/** The per-service health table printed once every resource is built and running. */
async function startupServiceHealth(run) {
    await printReadinessSuccess(run);
    run.printedSuccess = true;
    const ciWarning = attachedUpInCiWarning(process.env);
    if (ciWarning)
        console.log(chalk.yellow(ciWarning));
}
/** Services that declare `smoke` are checked through their public URL; a miss stops Tilt and fails the command. */
async function startupSmoke(run) {
    const { options } = run;
    const port = run.tiltPort;
    if (!options.quiet) {
        console.log(chalk.gray(`Smoke check: ${run.smokePlans.map((p) => p.name).join(", ")}`));
    }
    // The records hold response bodies, so they must not be committable. Warn before writing them when the ignore
    // entry could not be added.
    const ignoreWarning = ensureSmokeRecordsIgnored(run.projectRoot);
    if (ignoreWarning)
        console.warn(chalk.yellow(ignoreWarning));
    const results = await runSmokePlans(run.smokePlans, {
        recordDir: join(run.projectRoot, ".flisk", "smoke"),
        ...safeSmokeDeps(run.projectRoot, (message) => console.warn(chalk.yellow(message)), {
            // The selected env file holds secrets as much as the project .env.
            envFiles: run.envFileSelection ? [run.envFileSelection.path] : [],
        }),
    });
    const smokeFailures = [];
    for (const smokeResult of results) {
        if (smokeResult.ok) {
            if (!options.quiet)
                console.log(chalk.green(`Smoke check passed: ${smokeResult.name}`));
        }
        else {
            run.smokeFailed = true;
            smokeFailures.push(smokeResult.name);
            showError(formatSmokeFailure(smokeResult));
        }
    }
    if (run.smokeFailed) {
        stopTiltOnPort(port);
        const suggestions = upFailureHints({ kind: "smoke", failed: smokeFailures });
        showError("A smoke check failed; Tilt was stopped", undefined, suggestions);
        run.emit?.({ ok: false }, [
            upError("UP_SMOKE_FAILED", "A smoke check failed; Tilt was stopped", suggestions),
        ]);
    }
}
/** The --json success envelope for a healthy start. */
function startupEmitReady(run) {
    run.emit?.({
        ok: true,
        stack: run.stackName ?? null,
        services: run.startedServices,
        ...(run.options.only
            ? { requested: run.options.only, dependencies: run.startedDependencies }
            : {}),
        tiltUrl: `http://localhost:${run.tiltPort}`,
        ...(run.urlChecks ? { urls: run.urlChecks } : {}),
        ...(run.timings && run.timings.length > 0 ? { timings: run.timings } : {}),
    });
}
/**
 * Only a healthy, unchanged stack gets a fingerprint: the next `flisk up` can then answer in one read-only look
 * instead of regenerating files and restarting Tilt's build loop (#4193). Both the attached (human) and the --json
 * readiness paths set `startupFailed`, so either can record a healthy run.
 */
function startupRecordRun(run) {
    if (run.uiReady && !run.startupFailed && !run.smokeFailed) {
        recordHealthyRun({
            projectRoot: run.projectRoot,
            flags: run.fastFlags,
            tiltPort: run.tiltPort,
            stack: run.stackName ?? null,
            resources: run.servicesToStart,
            ingressPort: run.hostPortPlan.ingressHttp,
            gatewayEnabled: run.gatewayEnabled,
        });
    }
    else {
        clearFastNoopState(run.projectRoot);
    }
}
/**
 * The concurrent half of `tilt-up`: while `runTilt` streams in the foreground this waits for the Tilt UI, waits out
 * readiness, prints the health table, runs the smoke checks and emits the --json result, in `startupSteps` order.
 */
async function reportStartup(run) {
    await runUpSteps(run, startupSteps);
}
/**
 * The `flisk up` pipeline in order: the gates every run passes before a runtime is chosen, the runtime branches that
 * end the run early (git clone, --wait, fast no-op, inferred Node project, native run), and the container path.
 * The order is data, so "which steps ran" is assertable without executing side effects.
 */
export const upSteps = [
    { name: "secret-provider", run: upSecretProvider },
    { name: "git-clone", run: upGitClone },
    { name: "wait", run: upWait },
    { name: "json-quiet", run: upJsonQuiet },
    { name: "tilt-port", run: upTiltPort },
    { name: "fast-noop", run: upFastNoop },
    { name: "version-floor", run: upVersionFloor },
    { name: "clone-repos", guard: isRealRun, run: upCloneDeclaredRepos },
    { name: "inferred-node", run: upInferredNodeProject },
    { name: "native-run", run: upNativeRun },
    { name: "project-root", run: upRequireProject },
    { name: "platform-gate", run: upPlatformGate },
    { name: "env-file", run: upEnvFile },
    { name: "host-gate", run: upHostGate },
    { name: "docker-maintenance", guard: isRealRun, run: upDockerMaintenance },
    { name: "disk-guard", run: upDiskGuard },
    { name: "schema-gate", run: upSchemaGate },
    { name: "machine-preflight", guard: isRealRun, run: upMachinePreflight },
    { name: "container-run", run: upContainerRun },
];
/**
 * The container run's own ordered steps, dispatched inside the Tilt availability check (`withTiltCheck`, or
 * `runCommand` for a dry run). The refusals, project writes and selection run in this order on every container up.
 */
export const containerSteps = [
    { name: "project-root", run: containerProjectRoot },
    { name: "discovery", run: containerDiscovery },
    { name: "selection-args", run: containerSelectionArgs },
    { name: "drift-gate", run: containerDriftGate },
    { name: "service-config-gate", run: containerServiceConfigGate },
    { name: "dependency-warnings", run: containerDependencyWarnings },
    { name: "host-port-plan", run: containerHostPortPlan },
    { name: "project-writes", guard: isRealRun, run: containerProjectWrites },
    { name: "service-selection", run: containerServiceSelection },
    { name: "startup-plan", run: containerStartupPlan },
    { name: "dry-run", guard: isDryRun, run: containerDryRun },
    { name: "tilt-port-scan", run: containerTiltPortScan },
    { name: "attach-running", run: containerAttachRunning },
    { name: "only-blocked", run: containerOnlyBlocked },
    { name: "resolve-port", run: containerResolveTiltPort },
    { name: "cold-notice", run: containerColdNotice },
    { name: "model-preflight", guard: isRealRun, run: containerModelPreflight },
    { name: "tilt-up", run: containerTiltUp },
];
/**
 * The concurrent readiness report inside `tilt-up`, in order. `uiReady` gates every step after the first: when the
 * Tilt UI never answers, only the state record is cleared.
 */
export const startupSteps = [
    { name: "tilt-ui", run: startupWaitUi },
    {
        name: "json-readiness",
        guard: (run) => run.uiReady && run.emit !== undefined,
        run: startupJsonReadiness,
    },
    {
        name: "human-readiness",
        guard: (run) => run.uiReady && run.emit === undefined,
        run: startupHumanReadiness,
    },
    {
        name: "service-health",
        guard: (run) => run.uiReady && !run.options.quiet && !run.startupFailed,
        run: startupServiceHealth,
    },
    {
        name: "smoke",
        guard: (run) => run.uiReady &&
            run.smokePlans.length > 0 &&
            (run.emit !== undefined ? run.jsonReady : !run.startupFailed),
        run: startupSmoke,
    },
    {
        name: "emit-ready",
        guard: (run) => run.uiReady && run.jsonReady && !run.smokeFailed,
        run: startupEmitReady,
    },
    { name: "record-run", run: startupRecordRun },
    {
        name: "signal-failure",
        guard: (run) => run.startupFailed,
        run: (run) => {
            run.signalStartupFailed();
        },
    },
];
/**
 * Runs `steps` in order until one marks the run finished; a step that refuses calls `run.fail`, which exits.
 * The `flisk up` action is this loop over `upSteps` — nothing more.
 */
export async function runUpSteps(run, steps = upSteps) {
    for (const step of steps) {
        if (run.didFinish)
            return;
        if (step.guard !== undefined && !step.guard(run))
            continue;
        await step.run(run);
    }
}
