// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CHECKOUT_ID_ENV, CHECKOUT_NAME_ENV } from "../checkout-id.js";
import { expandEnvValue } from "../env-expand.js";
import { PROJECT_ENV_FILE_VAR } from "../env-selection.js";
import { parseEnv } from "../env-validator.js";
import { generateEntries } from "../generated-secrets.js";
import { declaresCommand } from "../native-service.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/**
 * `${VAR}` with no operator; `${VAR:-x}` and `${VAR-x}` carry a default and `${migrator:KEY}` names its own
 * source, so only the bare form can come back unset.
 */
const BARE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** The names `flisk up` exports for every run, so a reference to one is never unset. */
const PLATFORM_PROVIDED = new Set([CHECKOUT_ID_ENV, CHECKOUT_NAME_ENV]);
/** The values of the env file of the run (`FLISK_ENV_FILE`, else the project `.env`); empty when none can be read. */
function runEnvValues(projectRoot, env) {
    const envFile = env[PROJECT_ENV_FILE_VAR] || join(projectRoot, ".env");
    try {
        return existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf-8")) : new Map();
    }
    catch {
        // An unreadable env file fails where the file is read; here every name counts as missing.
        return new Map();
    }
}
/** The service directory's own `.env`, which a `command` service expands `${VAR}` against. Never printed. */
function serviceEnvValues(configPath) {
    try {
        return Object.fromEntries(parseEnv(readFileSync(join(dirname(configPath), ".env"), "utf-8")));
    }
    catch {
        return {};
    }
}
/**
 * The `${VAR}` names one `command` service's `env` expands to nothing, mirroring the scope planNativeRun
 * expands them in: the service directory's `.env`, the env file of the run and the shell, then earlier keys
 * of the same map. `expandEnvValue` reports every reference that has neither a value nor a `:-` default.
 */
function flagCommandServiceRefs(resource, envMap, fileValues, shell, flag) {
    const baseVars = {
        ...serviceEnvValues(resource.configPath),
        ...Object.fromEntries(fileValues),
        ...shell,
    };
    const expanded = {};
    for (const [envKey, value] of Object.entries(envMap)) {
        const missing = [];
        expanded[envKey] = expandEnvValue(String(value), { ...baseVars, ...expanded }, (name) => missing.push(name));
        for (const variable of missing)
            flag(envKey, variable);
    }
}
/**
 * The `${VAR}` references with no default in each service.json `env` that the env file of the run and the shell
 * both lack (#3104). Compose interpolates a missing name to an empty value and only warns, and a `command`
 * service expands it the same way, so a service starts broken with the cause only in its log (Lychee's `APP_KEY
 * is not set`). `env` applies to `command` services and bring-your-own resources; the manifest warning already
 * calls it ignored anywhere else.
 */
export function unsetEnvReferences(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot), env = process.env) {
    const fileValues = runEnvValues(projectRoot, env);
    const inShellOrFile = (name) => Boolean((env[name] ?? "").trim() || (fileValues.get(name) ?? "").trim());
    const unset = [];
    for (const resource of resources) {
        const config = resource.config;
        const envMap = resource.config?.env;
        if (!envMap || typeof envMap !== "object")
            continue;
        // `secrets.generate` names are written to the env file by `flisk up` before anything starts.
        const generated = generateEntries(config);
        const seen = new Set();
        const flag = (envKey, variable) => {
            if (seen.has(variable) ||
                inShellOrFile(variable) ||
                generated.has(variable) ||
                PLATFORM_PROVIDED.has(variable))
                return;
            seen.add(variable);
            unset.push({
                file: filePath(projectRoot, resource),
                service: resource.name,
                envKey,
                variable,
            });
        };
        if (declaresCommand(config)) {
            flagCommandServiceRefs(resource, envMap, fileValues, env, flag);
        }
        else if (config?.appType === "bring-your-own") {
            for (const [envKey, value] of Object.entries(envMap)) {
                for (const match of String(value).matchAll(BARE_REFERENCE))
                    flag(envKey, match[1]);
            }
        }
        // `env` on any other appType is ignored, which the manifest warning already says.
    }
    return unset;
}
/** One human-readable warning for `flisk config verify`. Names only, never a value. */
export function unsetEnvWarning(reference) {
    return `${reference.file}: ${reference.service}'s env ${reference.envKey} references \${${reference.variable}}, which is unset in .env and the shell`;
}
