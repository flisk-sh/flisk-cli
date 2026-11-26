// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { checkoutEnvVars } from "../checkout-id.js";
import { SERVICE_LOCAL_JSON } from "../constants.js";
import { dependsOnOf, healthyDependsOn } from "../dependency-graph.js";
import { expandEnvValue } from "../env-expand.js";
import { parseEnv } from "../env-validator.js";
import { FliskError } from "../errors.js";
import { getMigratorOutputPath, resolveMigratorOutputsInEnv, validateMigratorOutputReferences, } from "../migrator-output.js";
import { dockerRunArgs, dockerRunLine, isNativeContainerService, nativeContainerName, } from "../native-container.js";
import { paramsOf } from "../native-service.js";
import { programsForServiceCommand } from "../package-script-programs.js";
import { findProjectRoot } from "../paths.js";
import { healthCheckPathOf, isHealthCheckDisabled, isHealthCheckOptional, parseHealthCheckConfig, readinessProbeOf, } from "../service-manifest.js";
import { findOnPath } from "../which.js";
import { leadingProgram, pathHasRelativeEntry } from "./preflight.js";
/**
 * The spawn plan of the native runtime: the per-service plan `flisk up` builds before it starts anything, the
 * dependency order it starts in, and the program-availability preflight. Everything here is pure planning —
 * nothing in this module spawns, signals or probes a process.
 */
/** Defaults for the periodic re-probe of a ready local process (#4692). */
export const DEFAULT_REPROBE_INTERVAL_MS = 5_000;
export const DEFAULT_REPROBE_RETRIES = 3;
/** True for a resource that runs once and exits: a migrator, or a bring-your-own resource with `"restart": "no"`. */
export function isOneShotJob(config) {
    if (!config)
        return false;
    if (config.appType === "migrator")
        return true;
    return config.appType === "bring-your-own" && config.restart === "no";
}
/** `http://localhost:<port>` for display and health checks. Built here so callers never hold a URL literal. */
export function localUrl(port, path = "") {
    return `http://localhost:${port}${path}`;
}
/**
 * Whether a service gets its own process group. On Windows a detached child starts with its own console, and what it writes to
 * a pipe never reaches the parent: a crashed service's error (a missing variable, a stack trace) was lost, so the log files,
 * `flisk logs` and the failure text of `up` stayed empty. A Windows stop ends the whole tree with taskkill (signalGroup), so
 * it does not need a group; the cost is that a Ctrl+C in the terminal also reaches the services directly.
 */
export function detachesServices(platform = process.platform) {
    return platform !== "win32";
}
/**
 * Start order as waves: every service in a wave depends only on services in earlier waves. Names in `dependsOn` that are not
 * part of the selection are ignored here (planNativeRun reports them). Throws on a cycle; the service config gate refuses
 * cycles first, so this is a safety net.
 */
export function dependencyWaves(services) {
    const names = new Set(services.map((service) => service.name));
    const remaining = new Map(services.map((service) => [service.name, service.dependsOn.filter((dep) => names.has(dep))]));
    const done = new Set();
    const waves = [];
    while (remaining.size > 0) {
        const wave = [...remaining.entries()]
            .filter(([, deps]) => deps.every((dep) => done.has(dep)))
            .map(([name]) => name)
            .sort((a, b) => a.localeCompare(b));
        if (wave.length === 0) {
            throw new FliskError(`circular dependsOn between ${[...remaining.keys()].sort((a, b) => a.localeCompare(b)).join(", ")}`, ["Remove one dependsOn entry from the cycle in those services' service.json"]);
        }
        for (const name of wave) {
            remaining.delete(name);
            done.add(name);
        }
        waves.push(wave);
    }
    return waves;
}
/** The service directory's own `.env`, read only to expand `${VAR}`. A missing or unreadable file is ignored; values are never printed. */
function readServiceDotenv(dir) {
    if (!dir)
        return {};
    try {
        return Object.fromEntries(parseEnv(readFileSync(join(dir, ".env"), "utf-8")));
    }
    catch {
        return {};
    }
}
/**
 * Turns the selected `command` services into start plans and reports what would stop the run: a dependsOn that is not a service
 * of the selection (a database or the gateway needs Docker for now), and two services on one port.
 */
export function planNativeRun(selected, vars = process.env, projectRoot, projectName, options = {}) {
    const detectedRoot = projectRoot ?? findProjectRoot(selected[0]?.path ?? process.cwd());
    const root = detectedRoot ?? process.cwd();
    const containerProject = projectName ?? basename(root);
    const checkoutEnv = checkoutEnvVars(root, {
        persist: detectedRoot !== null && options.persistCheckout !== false,
    });
    const errors = [];
    const missingVars = [];
    const missingEnvRefs = [];
    // `enabled: false` (including a `service.local.json` override) is a local-process decision: plan
    // the service as absent instead of starting it and making its dependents wait for a port that never opens.
    // `flisk up` omits disabled services. A one-off `flisk run` of a disabled service still needs its
    // environment and PORT, so that caller opts in here without changing startup eligibility.
    const active = options.includeDisabled
        ? [...selected]
        : selected.filter((resource) => resource.config?.enabled !== false);
    const byName = new Map(selected.map((resource) => [resource.name, resource]));
    const disabled = new Set(selected
        .filter((resource) => resource.config?.enabled === false)
        .map((resource) => resource.name));
    const names = new Set(active.map((resource) => resource.name));
    const byStack = new Map();
    for (const resource of active) {
        if (resource.stack)
            byStack.set(resource.stack, [...(byStack.get(resource.stack) ?? []), resource.name]);
    }
    const portOwners = new Map();
    const services = active.map((resource) => {
        const config = resource.config ?? {};
        // The same reading as the Docker path: dependsOn plus the deprecated `dependencies`, and a stack name means its services.
        const dependsOn = [];
        const healthyDeps = [];
        const explicitlyHealthy = new Set(healthyDependsOn(config));
        for (const dep of dependsOnOf(config)) {
            if (names.has(dep)) {
                dependsOn.push(dep);
                if (explicitlyHealthy.has(dep))
                    healthyDeps.push(dep);
            }
            else if (byStack.has(dep)) {
                for (const member of byStack.get(dep) ?? [])
                    if (member !== resource.name) {
                        dependsOn.push(member);
                        if (explicitlyHealthy.has(dep))
                            healthyDeps.push(member);
                    }
            }
            else if (disabled.has(dep)) {
                const depPath = byName.get(dep)?.configPath;
                const where = depPath
                    ? `${basename(depPath)} or its sibling ${SERVICE_LOCAL_JSON}`
                    : "service.json or its sibling service.local.json";
                // Explicit policy: a dependent refuses to start while its dependency is disabled locally.
                errors.push(`service "${resource.name}" dependsOn "${dep}", which is disabled locally (enabled: false in ${where}). Enable it or remove the dependency before starting "${resource.name}".`);
            }
            else {
                errors.push(`service "${resource.name}" dependsOn "${dep}", which is not a service in this project. Add a "${dep}" service with a command, or with an "image" to run it as a container (a database, a cache), or remove it from dependsOn.`);
            }
        }
        const port = typeof config.port === "number" ? config.port : undefined;
        if (port !== undefined) {
            const owner = portOwners.get(port);
            if (owner)
                errors.push(`services "${owner}" and "${resource.name}" both use port ${port}`);
            else
                portOwners.set(port, resource.name);
        }
        const rawEnv = {};
        for (const [key, value] of Object.entries(config.env ?? {})) {
            rawEnv[key] = String(value);
        }
        // Without a health path a service is ready once its port listens, which is what gates its dependents.
        const healthDisabled = isHealthCheckDisabled(config);
        const healthOptional = isHealthCheckOptional(config);
        const rawHealthPath = healthDisabled ? undefined : healthCheckPathOf(config);
        const rawProbe = readinessProbeOf(config);
        // Only a manifest that actually configures re-probe timing needs a plan field; otherwise the supervisor uses the defaults.
        // `healthCheck: false` parses as disabled, so such a service is never re-probed.
        const healthCheck = parseHealthCheckConfig(config);
        const reprobe = healthCheck.enabled &&
            (healthCheck.interval !== undefined ||
                healthCheck.retries !== undefined ||
                healthCheck.onFailure !== undefined)
            ? {
                intervalMs: (healthCheck.interval ?? DEFAULT_REPROBE_INTERVAL_MS / 1000) * 1000,
                retries: healthCheck.retries ?? DEFAULT_REPROBE_RETRIES,
                onFailure: healthCheck.onFailure ?? "report",
            }
            : undefined;
        // A `${migrator:KEY}` reference in a late-bound string (the raw health path, the raw probe words) is held
        // unexpanded until the migrator outputs exist, so such a reference must name a dependency like the ones in env.
        const lateBoundStrings = {};
        if (rawHealthPath !== undefined)
            lateBoundStrings["healthCheck.path"] = rawHealthPath;
        if (rawProbe?.kind === "command") {
            rawProbe.command.forEach((part, index) => {
                lateBoundStrings[`healthCheck.command.${index}`] = part;
            });
        }
        try {
            validateMigratorOutputReferences(resource.name, { ...rawEnv, ...lateBoundStrings }, dependsOn);
        }
        catch (err) {
            if (err instanceof FliskError)
                errors.push(err.message);
            else
                throw err;
        }
        const env = {};
        // `vars` is already shell over project .env; the service directory's .env ranks below both and above the default.
        // Checkout identity vars always reflect the current checkout so stale inherited values from another checkout never leak.
        const serviceDotenv = readServiceDotenv(resource.path);
        const baseExpansionVars = { ...serviceDotenv, ...vars, ...checkoutEnv };
        const reportMissing = (name) => missingVars.push(`${resource.name}: ${name}`);
        for (const [key, value] of Object.entries(config.env ?? {})) {
            env[key] = expandEnvValue(String(value), { ...baseExpansionVars, ...env }, (name) => {
                reportMissing(name);
                missingEnvRefs.push({ service: resource.name, key, name });
            });
        }
        if (!("FLISK_CHECKOUT_ID" in env))
            env.FLISK_CHECKOUT_ID = checkoutEnv.FLISK_CHECKOUT_ID;
        if (!("FLISK_CHECKOUT_NAME" in env))
            env.FLISK_CHECKOUT_NAME = checkoutEnv.FLISK_CHECKOUT_NAME;
        const containerName = isNativeContainerService(resource)
            ? nativeContainerName(containerProject, resource.name)
            : undefined;
        const job = isOneShotJob(config) && port === undefined;
        if (job) {
            env.FLISK_OUTPUT = getMigratorOutputPath(root, resource.name);
        }
        if (port !== undefined && !containerName)
            env.PORT = String(port);
        const expandScope = { ...baseExpansionVars, ...env };
        // `params` (or `envVars` when `params` is absent) reaches the process the way the generated env file reaches a
        // container: literally, and below `env` and the generated values (PORT, FLISK_CHECKOUT_ID) on a shared name.
        // It is process env, not config, so it joins after `expandScope`: `${VAR}` expansion keeps reading only the
        // run's variables, never another service.json field.
        for (const [key, value] of Object.entries(paramsOf(config))) {
            if (!(key in env))
                env[key] = value;
        }
        // A local service's command is a shell line the project owner wrote in their own service.json. The platform shell
        // expands `${VAR}` at launch from the child environment (the run's env file and shell through baseEnv, plus this
        // env), so a value that contains quotes or `$()` reaches the process as literal argument data instead of being
        // reparsed as shell syntax, and one a migrator produces binds at spawn time, once the output exists. A container
        // service's line is built from its image and container.command below.
        let command = String(config.command);
        if (containerName) {
            const run = dockerRunArgs(resource, {
                projectName: containerProject,
                projectRoot: root,
                envKeys: Object.keys(env),
                envVars: expandScope,
                onMissing: reportMissing,
            });
            errors.push(...run.errors);
            command = dockerRunLine(run.args, containerName);
        }
        const healthPath = rawHealthPath !== undefined
            ? expandEnvValue(rawHealthPath, expandScope, reportMissing)
            : undefined;
        const probe = rawProbe?.kind === "command"
            ? {
                kind: "command",
                command: rawProbe.command.map((part) => expandEnvValue(part, expandScope, reportMissing)),
            }
            : rawProbe;
        // A container's healthCheck.command runs inside it, as the Compose health check does.
        const readiness = containerName && probe?.kind === "command"
            ? { kind: "command", command: ["docker", "exec", containerName, ...probe.command] }
            : probe;
        // A one-shot job with no port (every migrator, and a "restart": "no" process that serves nothing) is ready once it exits 0.
        // A "restart": "no" service with a port is ready once it exits 0 too, or via its port or health check while it keeps running (#5120).
        return {
            name: resource.name,
            command,
            cwd: resource.path,
            port,
            env,
            ...(Object.keys(rawEnv).length > 0 ? { rawEnv } : {}),
            dependsOn: [...new Set(dependsOn)],
            ...(healthyDeps.length > 0 ? { healthyDeps: [...new Set(healthyDeps)] } : {}),
            healthUrl: port !== undefined && healthPath ? localUrl(port, healthPath) : undefined,
            ...(rawHealthPath !== undefined ? { rawHealthPath } : {}),
            // A container with no HTTP health path is a database or a cache: print its address, not a web link.
            url: port === undefined
                ? undefined
                : containerName && !healthPath
                    ? `localhost:${port}`
                    : localUrl(port),
            restart: config.restart !== "no" && !job,
            ...(healthDisabled ? { healthCheckDisabled: true } : {}),
            ...(healthOptional ? { healthCheckOptional: true } : {}),
            ...(readiness ? { readiness } : {}),
            ...(reprobe ? { reprobe } : {}),
            ...(rawProbe?.kind === "command" ? { rawProbe } : {}),
            ...(job ? { job: true } : {}),
            ...(containerName ? { container: containerName } : {}),
        };
    });
    try {
        dependencyWaves(services);
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    return { services, errors, missingVars, missingEnvRefs };
}
/**
 * Binds the planning-time placeholders that `${migrator:KEY}` references left in a plan: the raw env entries re-expand
 * against the produced values, then the raw health path and probe words rebind so a placeholder is never probed. The
 * supervisor calls this once the outputs exist, before the service (re)starts.
 */
export function resolvePlanLateValues(plan, outputsRecord, baseEnv) {
    const hasLateEnv = plan.rawEnv !== undefined;
    const hasLateProbe = plan.rawHealthPath !== undefined || plan.rawProbe !== undefined;
    if (!hasLateEnv && !hasLateProbe)
        return;
    if (hasLateEnv) {
        const resolved = resolveMigratorOutputsInEnv(plan.name, plan.rawEnv, plan.dependsOn, outputsRecord);
        // The ranking planNativeRun expanded against: the service directory's .env, the run's variables, then the
        // service's own env — never the shell alone, which cannot see the run's variables.
        const planScope = () => ({
            ...readServiceDotenv(plan.cwd),
            ...baseEnv,
            ...plan.env,
        });
        // Direct migrator references bind first, so an alias of one (COPY: "${TOKEN}") re-expands against the
        // produced value in the pass below, not against the placeholder the plan started with (#4694).
        for (const [k, v] of Object.entries(resolved)) {
            if (v !== plan.rawEnv?.[k])
                plan.env[k] = expandEnvValue(v, planScope());
        }
        for (const [k, v] of Object.entries(resolved)) {
            if (v !== plan.rawEnv?.[k])
                continue;
            const rebound = expandEnvValue(v, planScope());
            if (rebound !== plan.env[k])
                plan.env[k] = rebound;
        }
    }
    // Values that depend on a migrator bind here, after the outputs exist: the placeholder planning kept in the
    // health path and the probe words is never probed. The scope keeps the plan-time ranking: the service
    // directory's `.env`, then the run's variables (baseEnv), then the service's own env.
    const scope = { ...readServiceDotenv(plan.cwd), ...baseEnv, ...plan.env };
    const rebind = (raw) => expandEnvValue(resolveMigratorOutputsInEnv(plan.name, { value: raw }, plan.dependsOn, outputsRecord).value ??
        "", scope);
    if (plan.rawHealthPath !== undefined && plan.port !== undefined) {
        plan.healthUrl = localUrl(plan.port, rebind(plan.rawHealthPath));
    }
    if (plan.rawProbe?.kind === "command") {
        const words = plan.rawProbe.command.map(rebind);
        // A container's healthCheck.command runs inside it, as the Compose health check does.
        plan.readiness = plan.container
            ? { kind: "command", command: ["docker", "exec", plan.container, ...words] }
            : { kind: "command", command: words };
    }
}
/**
 * Services whose command starts a program that is not on PATH, including programs started by a package-manager
 * script one level into the service's own package.json (#4680). A relative path such as ./bin/api is checked in the
 * service directory. `script` is set when the program came from a `scripts.<name>` entry.
 */
export function findMissingPrograms(plans, find = findOnPath, exists = existsSync, readFile) {
    const missing = [];
    const isMissing = (program, cwd) => !(program.includes("/")
        ? exists(isAbsolute(program) ? program : join(cwd, program))
        : Boolean(find(program)));
    for (const plan of plans) {
        const leading = leadingProgram(plan.command);
        if (!leading)
            continue;
        const { program, moved } = leading;
        // After a `cd`, a relative path — or a bare name on a relative PATH entry — belongs to the directory the shell
        // moved to, which this preflight does not know; leave it for the shell rather than report a program that runs.
        if (moved && (program.includes("/") || pathHasRelativeEntry()))
            continue;
        if (isMissing(program, plan.cwd)) {
            missing.push({ name: plan.name, program });
            continue;
        }
        // The script's own package.json is the service directory's, so a command that changed directory is not followed.
        if (moved)
            continue;
        for (const { program: scriptProgram, script } of programsForServiceCommand(plan.cwd, plan.command, readFile)) {
            if (script !== undefined && isMissing(scriptProgram, plan.cwd)) {
                missing.push({ name: plan.name, program: scriptProgram, script });
            }
        }
    }
    return missing;
}
