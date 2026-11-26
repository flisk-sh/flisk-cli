// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import fs from "node:fs";
import { dirname, join } from "node:path";
import type { DiscoveredResource, DiscoveryProblem, ResourceConfig } from "../../types/index.js";
import { SERVICE_JSON, SKIP_DIRECTORIES } from "../constants.js";
import { declaredDependsOn } from "../dependency-graph.js";
import { namesDirectoryLiterally, readDiscoveryPaths } from "../discovery-paths.js";
import { errorFactories, FliskError } from "../errors.js";
import { declaresCommand, validateNativeServiceFields } from "../native-service.js";
import { findProjectRoot } from "../paths.js";
import {
  getInvalidServiceRoutePathFields,
  validateGeneratedStringFields,
  validateServiceManifest,
} from "../service-manifest.js";
import { includes } from "../validation.js";
import { printServiceWarningOnce, warnAboutSkippedFiles } from "./warnings.js";

const RESOURCE_JSON_FILENAME = SERVICE_JSON;

/** Locale-independent order, so discovery is identical on every machine. */
function compareNamesByCodeUnit(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

function findServiceJsonFiles(projectRoot: string): string[] {
  const discoveryPaths = readDiscoveryPaths(projectRoot, { quiet: true });
  return walkServiceJsonFiles(projectRoot, projectRoot, [], discoveryPaths);
}

function walkServiceJsonFiles(
  projectRoot: string,
  dir: string,
  dirSegments: string[],
  discoveryPaths: string[],
  maxDepth: number = 5,
): string[] {
  const results: string[] = [];

  if (dirSegments.length > maxDepth) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(compareNamesByCodeUnit);

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const childSegments = [...dirSegments, entry.name];
      // A skipped folder is still walked when discovery.paths names it, e.g. `vendor/*`.
      if (
        shouldSkipDirectory(entry.name) &&
        !namesDirectoryLiterally(projectRoot, childSegments, discoveryPaths)
      ) {
        continue;
      }
      results.push(
        ...walkServiceJsonFiles(projectRoot, fullPath, childSegments, discoveryPaths, maxDepth),
      );
    } else if (entry.isFile() && entry.name === RESOURCE_JSON_FILENAME) {
      results.push(fullPath);
    }
  }

  return results;
}

export function discoverServiceManifestPaths(projectRoot: string): string[] {
  return findServiceJsonFiles(projectRoot);
}

function shouldSkipDirectory(name: string): boolean {
  return includes(SKIP_DIRECTORIES, name) || name.startsWith(".");
}

function isValidResourceConfig(value: unknown): value is ResourceConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  // A `command` service (the minimal contract) has no legacy forms: appName and appType.
  if (declaresCommand(config)) {
    return typeof config.appName === "string" && typeof config.appType === "string";
  }
  // Accept runtime, appType, or type (for backward compatibility with existing service.json files)
  const hasRuntimeOrAppType =
    typeof config.runtime === "string" ||
    typeof config.appType === "string" ||
    typeof config.type === "string";
  return typeof config.appName === "string" && hasRuntimeOrAppType;
}

function readLegacyAppType(parsed: Record<string, unknown>): ResourceConfig["appType"] | undefined {
  return typeof parsed.type === "string" ? (parsed.type as ResourceConfig["appType"]) : undefined;
}

const FIX_SERVICE_JSON = [
  "Fix that service.json",
  "Check every service.json with: flisk config verify",
];

export class InvalidServiceJsonError extends FliskError {
  public readonly code = "CONFIG_INVALID" as const;

  constructor(
    readonly reason: string,
    suggestions: string[] = [],
  ) {
    super(reason, suggestions);
    this.name = "InvalidServiceJsonError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseResource(serviceJsonPath: string): DiscoveredResource {
  let content: string;
  try {
    content = fs.readFileSync(serviceJsonPath, "utf-8");
  } catch (error) {
    throw new InvalidServiceJsonError(
      `could not read file: ${errorMessage(error)}`,
      FIX_SERVICE_JSON,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new InvalidServiceJsonError(`invalid JSON: ${errorMessage(error)}`, FIX_SERVICE_JSON);
  }

  if (!isValidResourceConfig(parsed)) {
    throw new InvalidServiceJsonError(
      declaresCommand(parsed as Record<string, unknown>)
        ? "missing required fields (appName and appType)"
        : "missing required fields (appName, runtime or appType)",
      FIX_SERVICE_JSON,
    );
  }

  const nativeErrors = validateNativeServiceFields(parsed as Record<string, unknown>);
  if (nativeErrors.length > 0)
    throw new InvalidServiceJsonError(nativeErrors.join("; "), FIX_SERVICE_JSON);

  const invalidRoutePathFields = getInvalidServiceRoutePathFields(parsed);
  if (invalidRoutePathFields.length > 0) {
    throw new InvalidServiceJsonError(
      invalidRoutePathFields.map((field) => `${field}: expected a string`).join("; "),
      FIX_SERVICE_JSON,
    );
  }

  const unsafeFields = validateGeneratedStringFields(
    parsed as Record<string, unknown>,
    serviceJsonPath,
  );
  if (unsafeFields.length > 0)
    throw new InvalidServiceJsonError(unsafeFields.join("; "), FIX_SERVICE_JSON);

  const parsedConfig = parsed;
  for (const warning of validateServiceManifest(parsed, serviceJsonPath).warnings) {
    // The warning names the file and field and says what is wrong (unknown, deprecated, ignored), so do not prefix it.
    printServiceWarningOnce(warning);
  }
  const config: ResourceConfig = {
    ...parsedConfig,
    appType: (parsedConfig.appType || readLegacyAppType(parsedConfig)) as ResourceConfig["appType"],
  };
  // `dependsOn` may hold `{ name, condition }` objects; everything after discovery reads names (the engine does the same).
  const dependsOnNames = declaredDependsOn(parsedConfig);
  if (Array.isArray(parsedConfig.dependsOn) && dependsOnNames) config.dependsOn = dependsOnNames;
  const resourceDir = dirname(serviceJsonPath);

  return {
    name: config.appName,
    path: resourceDir,
    configPath: serviceJsonPath,
    config,
    stack: config.stack,
    port: config.port,
    type: config.appType,
  };
}

const discoveryResultCache = new Map<
  string,
  { resources: DiscoveredResource[]; problems: DiscoveryProblem[] }
>();

/**
 * Invalidate cached `discoverResourcesWithProblems` results.
 *
 * Shares the lifetime and mutation contract of the discovery context cache:
 * `clearDiscoveryCache()` in discovery-context.ts calls this, so any command that
 * creates, mutates, or removes service manifests (`service.json`) keeps later
 * discovery in the same process observing the updated filesystem state.
 *
 * @param projectRoot Optional project root to invalidate. If omitted, all cached results are cleared.
 */
export function clearDiscoveryResultCache(projectRoot?: string): void {
  if (projectRoot !== undefined) {
    discoveryResultCache.delete(projectRoot);
  } else {
    discoveryResultCache.clear();
  }
}

export function discoverResourcesWithProblems(projectRoot: string): {
  resources: DiscoveredResource[];
  problems: DiscoveryProblem[];
} {
  // One walk per project root per process: several callers in one command need the
  // same tree, and the walk dominates the cost on large folders (#3809).
  const cached = discoveryResultCache.get(projectRoot);
  if (cached) {
    return { resources: [...cached.resources], problems: [...cached.problems] };
  }

  const serviceJsonPaths = findServiceJsonFiles(projectRoot);
  const resources: DiscoveredResource[] = [];
  const problems: DiscoveryProblem[] = [];

  for (const path of serviceJsonPaths) {
    try {
      resources.push(parseResource(path));
    } catch (error) {
      problems.push({
        path,
        reason: error instanceof InvalidServiceJsonError ? error.reason : errorMessage(error),
      });
    }
  }

  discoveryResultCache.set(projectRoot, { resources, problems });
  return { resources: [...resources], problems: [...problems] };
}

export function discoverResourcesFromRoot(projectRoot: string): DiscoveredResource[] {
  const { resources, problems } = discoverResourcesWithProblems(projectRoot);
  warnAboutSkippedFiles(problems);
  return resources;
}

export function discoverResources(): DiscoveredResource[] {
  const projectRoot = findProjectRoot();

  if (!projectRoot) {
    throw errorFactories.notInProject();
  }

  return discoverResourcesFromRoot(projectRoot);
}

export function discoverResourcesStrict(discovered?: {
  resources: DiscoveredResource[];
  problems: DiscoveryProblem[];
}): DiscoveredResource[] {
  let result = discovered;
  if (!result) {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      throw errorFactories.notInProject();
    }
    result = discoverResourcesWithProblems(projectRoot);
  }

  if (result.problems.length > 0) {
    throw new FliskError(
      result.problems
        .map((problem) => `Invalid service.json at ${problem.path}: ${problem.reason}`)
        .join("\n"),
      FIX_SERVICE_JSON,
    );
  }

  return result.resources;
}
