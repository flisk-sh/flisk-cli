// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { DiscoveredResource } from "../../../types/index.js";
import { checkColimaDisk } from "../../../utils/colima-disk.js";
import { checkDockerBuildCache } from "../../../utils/docker-build-cache.js";
import {
  checkDockerFileSharing,
  DOCKER_FILE_SHARING_CHECK,
} from "../../../utils/docker-file-sharing.js";
import { checkCodingAgents } from "../../../utils/doctor-agents.js";
import {
  checkColima,
  checkContainerEngine,
  checkDockerCompose,
  checkDockerOperatingSystem,
  checkDockerRuntime,
  withManifestTypos,
} from "../../../utils/doctor-container.js";
import { checkDuplicateFliskInstalls } from "../../../utils/doctor-fix.js";
import { checkDiskSpace } from "../../../utils/doctor-host.js";
import { checkIdleProjects } from "../../../utils/doctor-idle.js";
import {
  checkLatestFliskVersion,
  checkPublishedBindAddress,
  checkWslProjectLocation,
} from "../../../utils/doctor-machine.js";
import { checkNativeCommands, checkNativeRuntime } from "../../../utils/doctor-native.js";
import {
  checkBun,
  checkDockerVersions,
  checkPackageRunner,
  checkTilt,
} from "../../../utils/doctor-tools.js";
import { findProjectRoot } from "../../../utils/paths.js";
import { checkToolchains } from "../../../utils/toolchain.js";
import { checkDockerWslIntegration } from "../../../utils/wsl-integration.js";
import { hostPortsCheck, ingressPortsCheck } from "./host-ports.js";
import type { DoctorCheckSpec, DoctorTableEntry } from "./spec.js";

/** Opt-in only (#3128): scans the process list and agent session metadata, so default runs skip it. */
const codingAgentsCheck: DoctorCheckSpec = {
  name: "Coding agents",
  requires: null,
  when: (ctx) => Boolean(ctx.options.agents),
  run: (ctx) =>
    checkCodingAgents({
      startDir: process.cwd(),
      projectRoot: ctx.projectRoot,
      strict: ctx.options.strict as boolean,
    }),
};

const wslProjectLocationCheck: DoctorCheckSpec = {
  name: "WSL project location",
  requires: null,
  when: (ctx) => ctx.includeWslChecks,
  run: (ctx) =>
    checkWslProjectLocation(findProjectRoot() ?? process.cwd(), ctx.options.strict as boolean),
};

const packageRunnerCheck: DoctorCheckSpec = {
  name: "Package Runner",
  requires: null,
  run: (ctx) => checkPackageRunner({ strict: ctx.options.strict }),
};

/** The machine table for a Docker stack: the host probes, then the container-runtime gated checks. */
export const CONTAINER_MACHINE_CHECKS: DoctorTableEntry[] = [
  hostPortsCheck,
  ingressPortsCheck,
  {
    name: "Colima",
    requires: null,
    run: async (ctx) => withManifestTypos(await checkColima(), ctx.manifestTypoNotes()),
  },
  // A stack left running for days keeps its own Traefik, Postgres and volumes; warn with an exact stop command (#4296).
  { name: "Idle Projects", requires: "container-runtime", run: () => checkIdleProjects() },
  { name: "Container Engine", requires: null, run: () => checkContainerEngine() },
  {
    name: "Container Runtime",
    requires: null,
    run: async (ctx) =>
      withManifestTypos(await checkDockerRuntime(ctx.hostCommandCache), ctx.manifestTypoNotes()),
  },
  { name: "Disk Space", requires: null, run: () => checkDiskSpace() },
  {
    name: "Docker Build Cache",
    requires: "container-runtime",
    run: (ctx) => checkDockerBuildCache(undefined, undefined, { live: Boolean(ctx.options.fix) }),
  },
  { name: "Colima Disk", requires: "container-runtime", run: () => checkColimaDisk() },
  {
    name: "Docker OS",
    requires: "container-runtime",
    run: (ctx) => checkDockerOperatingSystem(ctx.cachedExec),
  },
  { name: "Tilt CLI", requires: null, run: () => checkTilt() },
  {
    name: "Docker Compose",
    requires: "container-runtime",
    run: (ctx) => checkDockerCompose(ctx.cachedExec),
  },
  {
    name: "Docker Versions",
    requires: "container-runtime",
    run: (ctx) => checkDockerVersions(ctx.cachedExec),
  },
  { name: "Bun", requires: null, run: () => checkBun() },
  packageRunnerCheck,
  wslProjectLocationCheck,
  {
    name: "Dev Port Bind Address",
    requires: null,
    run: (ctx) => checkPublishedBindAddress(process.env, ctx.options.strict),
  },
  // Each project needs several networks; a full address pool fails `flisk up` late.
  { wiring: "machine" },
  {
    name: "Docker File Sharing",
    requires: "container-runtime",
    run: (ctx) => {
      if (ctx.options.dockerProbe === false) {
        return {
          name: DOCKER_FILE_SHARING_CHECK,
          didPass: true,
          isSkipped: true,
          message: "Skipped the bind-mount probe (--no-docker-probe)",
        };
      }
      return checkDockerFileSharing({
        timeoutMs: ctx.dockerProbeTimeout,
        probeEnvironment: ctx.probeEnv(),
      });
    },
  },
  {
    name: "Docker WSL integration",
    requires: null,
    when: (ctx) => ctx.includeWslChecks,
    run: () => checkDockerWslIntegration(),
  },
  { name: "Flisk installs", requires: null, run: () => checkDuplicateFliskInstalls() },
  { name: "Latest Flisk version", requires: null, run: () => checkLatestFliskVersion() },
  codingAgentsCheck,
];

/** The machine table for a project of local processes: what its commands need, no Docker or Tilt. */
export function nativeMachineChecks(resources: DiscoveredResource[]): DoctorTableEntry[] {
  return [
    { name: "Runtime", requires: null, run: () => checkNativeRuntime(resources) },
    {
      name: "Disk Space",
      requires: null,
      run: (ctx) => checkDiskSpace(undefined, undefined, undefined, ctx.diskRuntime),
    },
    { name: "Service commands", requires: null, run: () => checkNativeCommands(resources) },
    { name: "Service toolchains", requires: null, run: () => checkToolchains(resources) },
    packageRunnerCheck,
    wslProjectLocationCheck,
    { name: "Flisk installs", requires: null, run: () => checkDuplicateFliskInstalls() },
    codingAgentsCheck,
  ];
}
