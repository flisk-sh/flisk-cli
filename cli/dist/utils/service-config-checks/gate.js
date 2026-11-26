// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { checkDuplicateResourceNames } from "../doctor-wiring.js";
import { discoverResourcesFromRoot } from "../services.js";
import { checkCircularDependencies, checkDependsOnShape } from "./dependencies.js";
import { checkCustomDockerfiles } from "./dockerfiles.js";
import { checkServiceFields } from "./fields.js";
import { checkServicePorts } from "./ports.js";
import { checkRequiredSecrets } from "./secrets.js";
import { checkSidecars } from "./sidecars.js";
import { checkVolumes } from "./volumes.js";
/**
 * Runs before anything starts (also under --dry-run, like the drift gate): duplicate service names, circular
 * dependsOn and invalid ports exit with 1 and say which file, which field, and how to fix it.
 */
export function enforceServiceConfigGate(projectRoot, options = {}, exit = process.exit) {
    const resources = options.resources ?? discoverResourcesFromRoot(projectRoot);
    const checks = [
        checkDuplicateResourceNames(projectRoot, resources),
        checkServiceFields(projectRoot, resources),
        checkCustomDockerfiles(projectRoot, resources),
        checkRequiredSecrets(projectRoot, resources),
        checkDependsOnShape(projectRoot, resources),
        checkCircularDependencies(projectRoot, resources),
        checkServicePorts(projectRoot, resources),
        checkSidecars(projectRoot, resources),
        checkVolumes(projectRoot, resources),
    ];
    for (const check of checks.filter((entry) => entry.isWarning)) {
        options.onWarning?.(check.message);
        console.warn(chalk.yellow(`⚠ ${check.message}`));
        if (check.fix)
            console.warn(chalk.gray(`  Fix: ${check.fix}`));
    }
    const failed = checks.filter((check) => !check.didPass && !check.isWarning);
    if (failed.length === 0)
        return;
    const text = failed
        .map((check) => `${check.message}${check.fix ? `\nFix: ${check.fix}` : ""}`)
        .join("\n");
    options.onInvalid?.(text);
    for (const check of failed) {
        console.error(chalk.red(`✗ ${check.message}`));
        if (check.fix)
            console.error(chalk.gray(`  Fix: ${check.fix}`));
    }
    exit(1);
}
