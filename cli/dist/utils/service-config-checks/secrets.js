// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import chalk from "chalk";
import { PROJECT_ENV_FILE_VAR } from "../env-selection.js";
import { parseEnv } from "../env-validator.js";
import { formatCount } from "../formatting.js";
import { generateEntries } from "../generated-secrets.js";
import { findProjectRoot } from "../paths.js";
import { hasSecretBridge, readSecretProvider, secretProviderUsageError, } from "../secret-provider.js";
import { providersOf, secretConflictWarnings, secretsErrors } from "../service-manifest.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/**
 * `secrets.required` names that neither the env file of the run nor the environment holds a value for. Compose refuses to
 * interpolate such a name, and that fails the whole Tiltfile, so every service stops, not only the one that needs the secret.
 * With `FLISK_SECRET_PROVIDER=infisical` the names are left to a bridge; the free build has none, so it warns per name.
 */
export function checkRequiredSecrets(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot), env = process.env) {
    const usageError = secretProviderUsageError(env);
    if (usageError)
        throw usageError;
    const shapeErrors = resources.flatMap((resource) => resource.config
        ? secretsErrors(resource.config, filePath(projectRoot, resource))
        : []);
    if (shapeErrors.length > 0) {
        return {
            name: "Required secrets",
            didPass: false,
            message: `${formatCount(shapeErrors.length, "invalid secrets field")}:\n    ${shapeErrors.join("\n    ")}`,
            fix: 'Set "secrets" in service.json to an object like { "required": ["NAME"] }',
        };
    }
    const { value: provider } = readSecretProvider(env);
    if (provider === "infisical") {
        if (hasSecretBridge(env)) {
            return {
                name: "Required secrets",
                didPass: true,
                message: "Secrets are left to the secret provider",
            };
        }
        // Nothing injects these names in this build: even a value in .env stays unused.
        const names = [
            ...new Set(resources.flatMap((resource) => {
                const required = resource.config?.secrets
                    ?.required;
                return Array.isArray(required)
                    ? required.filter((name) => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
                    : [];
            })),
        ];
        return {
            name: "Required secrets",
            didPass: true,
            isWarning: true,
            message: names.length
                ? `FLISK_SECRET_PROVIDER=infisical: this build has no Infisical client; ${names.join(", ")} will be empty`
                : "FLISK_SECRET_PROVIDER=infisical: this build has no Infisical client; no required secrets to inject",
            fix: "Set FLISK_SECRET_PROVIDER=env-file and add the names to the project .env, or use a build with a secret bridge",
        };
    }
    const envFile = env[PROJECT_ENV_FILE_VAR] || join(projectRoot, ".env");
    let fileValues = new Map();
    try {
        if (existsSync(envFile))
            fileValues = parseEnv(readFileSync(envFile, "utf-8"));
    }
    catch {
        // An unreadable env file is reported where the file is read; here every name counts as missing.
    }
    const has = (name) => Boolean((env[name] ?? "").trim() || (fileValues.get(name) ?? "").trim());
    const problems = resources.flatMap((resource) => {
        const required = resource.config?.secrets
            ?.required;
        // `secrets.generate` names are written to the env file by `flisk up` before anything starts.
        const generated = generateEntries(resource.config);
        const missingSecrets = (Array.isArray(required) ? required : [])
            .filter((name) => typeof name === "string" &&
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
            !has(name) &&
            !generated.has(name))
            .map((name) => `${filePath(projectRoot, resource)}: secret ${name} has no value`);
        // A provider's token is required unless the provider has a local fallback (service.json `providers`).
        const missingTokens = providersOf(resource.config)
            .filter((provider) => provider.required &&
            provider.tokenSecret !== undefined &&
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(provider.tokenSecret) &&
            !has(provider.tokenSecret) &&
            !missingSecrets.some((line) => line.endsWith(` ${provider.tokenSecret} has no value`)))
            .map((provider) => `${filePath(projectRoot, resource)}: secret ${provider.tokenSecret} (token of provider ${provider.id}) has no value`);
        return [...missingSecrets, ...missingTokens];
    });
    if (problems.length === 0) {
        return {
            name: "Required secrets",
            didPass: true,
            message: "Every required secret has a value",
        };
    }
    return {
        name: "Required secrets",
        didPass: false,
        message: `${formatCount(problems.length, "required secret")} without a value:\n    ${problems.join("\n    ")}`,
        fix: `Add NAME=value to ${relative(projectRoot, envFile) || ".env"} (it is gitignored), or export it in the environment, or move it to "optional"`,
    };
}
/** Prints each secret that a literal in `params` or `env` overrides. A warning: such a project still starts. */
export function warnSecretConflicts(projectRoot, resources) {
    for (const resource of resources ?? discoverResourcesFromRoot(projectRoot)) {
        if (!resource.config)
            continue;
        for (const warning of secretConflictWarnings(resource.config, filePath(projectRoot, resource)))
            console.warn(chalk.yellow(`⚠ ${warning}`));
    }
}
