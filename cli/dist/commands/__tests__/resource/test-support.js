// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_TEMPLATE, createByoServiceJson, createDatabaseServiceJson, createPackageJson, createResourceTestTsconfig, createResourceTsconfig, createServiceJson, DRIZZLE_CONFIG_TEMPLATE, DRIZZLE_DB_TEMPLATE, DRIZZLE_SCHEMA_TEMPLATE, getBackendIndexTemplate, getDockerfileTemplate, getDrizzleBackendIndexTemplate, getWorkerIndexTemplate, PRISMA_CONFIG_TEMPLATE, PRISMA_SCHEMA_TEMPLATE, parseExistingServiceJson, parseResourceType, ROOT_TSCONFIG_BASE, TSCONFIG_TEMPLATE, TYPE_SPECIFIC, withViteEnvTypes, } from "../../../commands/resource.js";
import { FRONTEND_FRAMEWORKS, getFrontendFramework, resolveFrontendFramework, } from "../../../frontend-frameworks/registry.js";
import { CREATABLE_RESOURCE_TYPES, isCreatableResourceType, isResourceCreateType, RESOURCE_CREATE_TYPE_VALUES, } from "../../../types/index.js";
import { FliskError } from "../../../utils/errors.js";
import { discoverResourcesFromRoot } from "../../../utils/services.js";
import { KEBAB_CASE_REGEX } from "../../../utils/validation.js";
const resourceCliPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../bin/flisk.js");
function createResourceProject() {
    const projectRoot = mkdtempSync(join(tmpdir(), "flisk-resource-cli-"));
    mkdirSync(join(projectRoot, ".flisk"), { recursive: true });
    writeFileSync(join(projectRoot, ".flisk", "project.json"), "{}\n");
    return projectRoot;
}
function runResourceCli(projectRoot, args, input = "") {
    return spawnSync(process.execPath, [resourceCliPath, "resource", ...args], {
        cwd: projectRoot,
        input,
        encoding: "utf8",
    });
}
export { BASE_TEMPLATE, CREATABLE_RESOURCE_TYPES, createByoServiceJson, createDatabaseServiceJson, createPackageJson, createResourceProject, createResourceTestTsconfig, createResourceTsconfig, createServiceJson, DRIZZLE_CONFIG_TEMPLATE, DRIZZLE_DB_TEMPLATE, DRIZZLE_SCHEMA_TEMPLATE, describe, dirname, discoverResourcesFromRoot, execSync, existsSync, expect, FliskError, FRONTEND_FRAMEWORKS, fileURLToPath, getBackendIndexTemplate, getDockerfileTemplate, getDrizzleBackendIndexTemplate, getFrontendFramework, getWorkerIndexTemplate, isCreatableResourceType, isResourceCreateType, it, join, KEBAB_CASE_REGEX, mkdirSync, mkdtempSync, PRISMA_CONFIG_TEMPLATE, PRISMA_SCHEMA_TEMPLATE, parseExistingServiceJson, parseResourceType, RESOURCE_CREATE_TYPE_VALUES, ROOT_TSCONFIG_BASE, readdirSync, readFileSync, realpathSync, resolveFrontendFramework, resourceCliPath, rmSync, runResourceCli, spawnSync, TSCONFIG_TEMPLATE, TYPE_SPECIFIC, tmpdir, withViteEnvTypes, writeFileSync, };
