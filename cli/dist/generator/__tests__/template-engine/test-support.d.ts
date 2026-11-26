import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { ProjectConfig } from "../../../types/index.js";
import { FliskError } from "../../../utils/errors.js";
import { compileTemplate } from "../../mini-template.js";
import { ensureProjectRuntimeAssets, findCliAssetRoot, generateDatabaseManagementCompose, generateMasterConfigs, isTestFile, loadTemplate, ProjectConfigNotFoundError, readProjectConfig, staleServiceOutputs, TemplateEngine, verifyMasterConfigs } from "../../template-engine.js";
declare const fsState: {
    existsSync: MockInstance;
    actualExistsSync: ((filePath: string | Buffer | URL) => boolean) | null;
};
declare const repoRoot: string;
declare const readEngine: (rel: string) => string;
declare const REAL_TEMPLATES: Record<string, string>;
declare function projectConfig(overrides?: Partial<ProjectConfig>): ProjectConfig;
declare function completeProjectConfig(name: string): {
    version: string;
    project: {
        name: string;
        version: string;
    };
    phases: {
        pre_alpha: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
        alpha: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
        beta: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
        out_of_scope: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
    };
    optional_infra: {
        monitoring: boolean;
        elk: boolean;
        debezium: boolean;
        golden_image: boolean;
        verdaccio: boolean;
    };
    discovery: {
        paths: string[];
    };
    overrides: {};
};
declare function mockExistsIgnoringRepoRuntime(originalExistsSync: (filePath: string | Buffer | URL) => boolean): void;
declare function writeProjectJson(projectRoot: string, config: unknown): void;
export type { ProjectConfig } from "../../../types/index.js";
export { afterEach, beforeEach, compileTemplate, completeProjectConfig, describe, ensureProjectRuntimeAssets, expect, FliskError, fileURLToPath, findCliAssetRoot, fs, fsState, generateDatabaseManagementCompose, generateMasterConfigs, isTestFile, it, loadTemplate, mockExistsIgnoringRepoRuntime, os, ProjectConfigNotFoundError, path, projectConfig, REAL_TEMPLATES, readEngine, readProjectConfig, repoRoot, staleServiceOutputs, TemplateEngine, verifyMasterConfigs, vi, writeProjectJson, };
export declare function expectProjectConfigNotFound(caught: unknown, projectJsonPath: string): void;
export declare function expectProjectConfigReadFailure(caught: unknown, projectJsonPath: string, expectedReason: string): void;
export declare function readInstallDeps(projectRoot: string): string;
