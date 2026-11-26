// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { execSync } from "node:child_process";
import type { DiscoveredResource } from "../../../types/index.js";
import { checkDuplicateDatabaseNames } from "../../../utils/doctor-database-names.js";
import { checkDatabaseNamesInUse } from "../../../utils/doctor-databases-in-use.js";
import {
  checkLocalServiceDependencies,
  checkWorktreeEnv,
} from "../../../utils/doctor-local-deps.js";
import {
  checkEnvironmentVariables,
  checkFliskVersion,
  checkMasterConfigs,
} from "../../../utils/doctor-machine.js";
import {
  checkNativeDependsOn,
  checkNativeEnvReferences,
  checkNativeServiceScripts,
} from "../../../utils/doctor-native.js";
import {
  checkFrontendDockerPreflight,
  checkGeneratedFiles,
  checkGeneratedProjectRuntimeAssets,
  checkResourceDiscovery,
  checkStartupScripts,
  checkTiltIgnoredResourceNames,
  checkTypeScriptTypeDependencies,
} from "../../../utils/doctor-project.js";
import { checkHealthRoutes, checkTiltResourceHealth } from "../../../utils/doctor-runtime.js";
import { checkContainerResourceHealth } from "../../../utils/doctor-services.js";
import { checkStarlarkLoadExports } from "../../../utils/doctor-starlark.js";
import { checkProjectRepos } from "../../../utils/project-repos.js";
import { checkPublicEnvSecrets } from "../../../utils/public-env-secrets.js";
import { checkRemoteEnvHosts } from "../../../utils/remote-env-hosts.js";
import {
  checkCircularDependencies,
  checkDependsOnShape,
  checkGpuRuntime,
  checkModelRunner,
  checkNetworkPorts,
  checkPostgresVolumes,
  checkRequiredSecrets,
  checkSchemaVersions,
  checkServicePorts,
  checkSidecars,
  checkVolumes,
} from "../../../utils/service-config-checks.js";
import { crashLoopingContainersCheck } from "./crashloop.js";
import { privateNpmRegistryCheck } from "./npm-registry.js";
import type { DoctorTableEntry } from "./spec.js";

/** Flisk version drift and service-repo drift; both check lists open with them. */
const versionAndRepoChecks: DoctorTableEntry[] = [
  { name: "Flisk version", requires: null, run: () => checkFliskVersion() },
  {
    name: "Service Repositories",
    requires: null,
    run: (ctx) =>
      checkProjectRepos(ctx.checkDir, undefined, undefined, { strict: ctx.options.strict }),
  },
];

/** What the service.json declarations already prove wrong, before anything is probed. */
const declarationChecks: DoctorTableEntry[] = [
  { wiring: "declaration" },
  { name: "dependsOn", requires: null, run: () => checkDependsOnShape() },
  {
    name: "Required secrets",
    requires: null,
    run: (ctx) => checkRequiredSecrets(ctx.checkDir, undefined, process.env),
  },
  // A fresh worktree has the sources but not the gitignored installs or .env (#4048).
  {
    name: "Local service dependencies",
    requires: null,
    run: (ctx) => checkLocalServiceDependencies(ctx.checkDir),
  },
  { name: "Worktree .env", requires: null, run: (ctx) => checkWorktreeEnv(ctx.checkDir) },
];

/** The resource graph: cycles and declared-port collisions. */
const graphChecks: DoctorTableEntry[] = [
  { name: "Circular dependencies", requires: null, run: () => checkCircularDependencies() },
  { name: "Service ports", requires: null, run: () => checkServicePorts() },
];

/** service.json schema versions and the port-shape wiring rows. */
const schemaAndPortChecks: DoctorTableEntry[] = [
  {
    name: "schemaVersion",
    requires: null,
    run: (ctx) => checkSchemaVersions(undefined, ctx.options.strict),
  },
  { wiring: "schema" },
];

/** Env files: committed secrets and remote hosts. */
const envHygieneChecks: DoctorTableEntry[] = [
  {
    name: "Public Environment Secrets",
    requires: null,
    run: (ctx) => checkPublicEnvSecrets(ctx.checkDir, ctx.options.strict),
  },
  {
    name: "Remote hosts in env",
    requires: null,
    run: (ctx) => checkRemoteEnvHosts(ctx.checkDir, ctx.options.strict),
  },
];

/** The project table for a Docker stack. */
export const CONTAINER_PROJECT_CHECKS: DoctorTableEntry[] = [
  ...versionAndRepoChecks,
  { name: "Master Configs", requires: null, run: () => checkMasterConfigs() },
  {
    name: "Generated Runtime Assets",
    requires: null,
    run: () => checkGeneratedProjectRuntimeAssets(),
  },
  {
    name: "Generated Files",
    requires: null,
    run: (ctx) => checkGeneratedFiles(ctx.options.strict),
  },
  { name: "Starlark Load Exports", requires: null, run: () => checkStarlarkLoadExports() },
  { name: "Startup Scripts", requires: null, run: () => checkStartupScripts() },
  // A backend without its health route never turns healthy; Traefik 404s it.
  { name: "Health Routes", requires: null, run: () => checkHealthRoutes() },
  {
    name: "TypeScript Type Dependencies",
    requires: null,
    run: () => checkTypeScriptTypeDependencies(),
  },
  {
    name: "Frontend Docker Preflight",
    requires: null,
    run: () => checkFrontendDockerPreflight(),
  },
  { name: "Resource Discovery", requires: null, run: () => checkResourceDiscovery() },
  {
    name: "Ignored Names",
    requires: null,
    run: () => checkTiltIgnoredResourceNames(),
  },
  // Wiring mistakes that otherwise surface minutes into `flisk up`.
  { wiring: "discovery" },
  ...declarationChecks,
  ...graphChecks,
  { name: "Sidecars", requires: null, run: () => checkSidecars() },
  { name: "Network ports", requires: null, run: () => checkNetworkPorts() },
  { name: "GPU runtime", requires: null, run: () => checkGpuRuntime() },
  { name: "Docker Model Runner", requires: null, run: () => checkModelRunner() },
  { name: "Volumes", requires: null, run: () => checkVolumes() },
  {
    name: "Postgres volume",
    requires: null,
    run: (ctx) => checkPostgresVolumes(undefined, undefined, ctx.options.strict),
  },
  // The shared-Postgres names running checkouts actually claim, so a stale stack still on an old name warns.
  { name: "Database Names In Use", requires: null, run: () => checkDatabaseNamesInUse() },
  { name: "Database Name Collisions", requires: null, run: () => checkDuplicateDatabaseNames() },
  ...schemaAndPortChecks,
  // Shared platform Postgres: will-start report + unknown dependsOn names stay errors.
  { wiring: "wiring" },
  { name: "Environment Variables", requires: null, run: () => checkEnvironmentVariables() },
  ...envHygieneChecks,
  privateNpmRegistryCheck,
  // Runtime checks: skip gracefully if the stack isn't started yet.
  {
    name: "Container Resource Health",
    requires: "container-runtime",
    run: () => checkContainerResourceHealth(),
  },
  crashLoopingContainersCheck,
  // When Tilt is up, surface red resources (Traefik/apps never started).
  {
    name: "Tilt Resources",
    requires: "container-runtime",
    run: (ctx) => checkTiltResourceHealth(execSync, { projectRoot: ctx.projectRoot }),
  },
];

/** The project table for a project of local processes (no Docker, no Tilt). */
export function nativeProjectChecks(resources: DiscoveredResource[]): DoctorTableEntry[] {
  return [
    ...versionAndRepoChecks,
    ...declarationChecks,
    {
      name: "Ignored Names",
      requires: null,
      run: () => checkTiltIgnoredResourceNames(),
    },
    { name: "Service dependencies", requires: null, run: () => checkNativeDependsOn(resources) },
    {
      name: "Service scripts",
      requires: null,
      run: () => checkNativeServiceScripts(resources),
    },
    {
      name: "Service env references",
      requires: null,
      run: (ctx) => checkNativeEnvReferences(ctx.checkDir, resources),
    },
    {
      name: "Postgres volume",
      requires: null,
      run: (ctx) => checkPostgresVolumes(ctx.checkDir, resources, ctx.options.strict),
    },
    { name: "Database Name Collisions", requires: null, run: () => checkDuplicateDatabaseNames() },
    ...graphChecks,
    ...schemaAndPortChecks,
    ...envHygieneChecks,
  ];
}
