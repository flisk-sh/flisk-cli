// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { SERVICE_MANIFEST_SCHEMA_VERSION } from "../service-manifest.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/**
 * A service.json with no schemaVersion is how every project began, so this is a warning: it keeps working, and only
 * `flisk config migrate` writes the field. A version this flisk does not know is reported the same way, with a different fix.
 */
export function checkSchemaVersions(projectRoot = findProjectRoot() ?? process.cwd(), strict = false, resources = discoverResourcesFromRoot(projectRoot)) {
    const missing = [];
    const unsupported = [];
    for (const resource of resources) {
        const version = resource.config?.schemaVersion;
        if (version === SERVICE_MANIFEST_SCHEMA_VERSION)
            continue;
        const file = filePath(projectRoot, resource);
        if (version === undefined)
            missing.push(`${file} schemaVersion: missing`);
        else
            unsupported.push(`${file} schemaVersion ${JSON.stringify(version)}: this flisk supports ${SERVICE_MANIFEST_SCHEMA_VERSION}`);
    }
    if (missing.length === 0 && unsupported.length === 0) {
        return {
            name: "schemaVersion",
            didPass: true,
            message: "Every service.json has a supported schemaVersion",
        };
    }
    const fixes = [
        ...(missing.length > 0 ? ["Run `flisk config migrate` to add the missing schemaVersion"] : []),
        ...(unsupported.length > 0
            ? ["A version this flisk does not support cannot be migrated: upgrade flisk"]
            : []),
    ];
    return {
        name: "schemaVersion",
        didPass: false,
        isWarning: !strict,
        message: `${formatCount(missing.length + unsupported.length, "service.json file")} without a supported schemaVersion:\n    ${[...missing, ...unsupported].join("\n    ")}`,
        fix: fixes.join(". "),
    };
}
/** Prints the schemaVersion warning once. It never stops anything: the project keeps working as it is. */
export function warnSchemaVersions(projectRoot, resources) {
    const check = checkSchemaVersions(projectRoot, false, resources);
    if (check.didPass)
        return;
    console.warn(chalk.yellow(`⚠ ${check.message}`));
    if (check.fix)
        console.warn(chalk.gray(`  ${check.fix}`));
}
