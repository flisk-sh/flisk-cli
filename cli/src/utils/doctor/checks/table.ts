// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { execSync } from "node:child_process";
import type { CheckResult, DiscoveredResource } from "../../../types/index.js";
import type { DoctorProbeEnvironment } from "../../doctor-probe-cache.js";
import { type DoctorCheckFn, requiresContainerRuntime } from "../../doctor-runner.js";
import type { ExecAsync } from "../../exec-async.js";
import { checkClaudeGeneratedGuardHook } from "./claude-guard.js";
import { checkComposeEventWatchers } from "./compose-watchers.js";
import { checkDockerNetworkCapacity } from "./docker-networks.js";
import { checkInfraFrameworks } from "./frameworks.js";
import { checkHealthCheckTools } from "./healthcheck-tools.js";
import { checkLiteralPorts } from "./literal-ports.js";
import { checkMigrationsInApi } from "./migrations.js";
import { checkDuplicateResourceNames, checkDuplicateResourcePorts } from "./names.js";
import { checkNatsBroker } from "./nats.js";
import { checkResourcePackageJson } from "./package-json.js";
import { checkPostgresCredentials, checkSharedPlatformPostgres } from "./postgres.js";
import { checkPrismaConsistency } from "./prisma.js";
import { checkSharedStackRoutes } from "./routes.js";
import { checkValidServiceJsonFiles } from "./service-json.js";
import { checkTiltInstances } from "./tilt.js";
import { checkFrontendBackendUrls, checkServiceUrlPorts } from "./urls.js";

/**
 * Where a wiring check runs inside `flisk doctor`. The table is the run order:
 * doctor.ts expands each slot into the matching group of its check list, so a
 * new check is one module plus one row here and no other file changes.
 */
export type DoctorWiringSlot =
  /** Right after resource discovery: what the files on disk already prove wrong. */
  | "discovery"
  /** With the service.json declaration checks. */
  | "declaration"
  /** With the schema-version and port-shape checks. */
  | "schema"
  /** The wiring block: cross-resource mistakes that surface minutes into `flisk up`. */
  | "wiring"
  /** The machine checks: probes of the container host itself. */
  | "machine";

/** The slots a doctor run expands, in the order the groups appear in its check lists. */
export const DOCTOR_WIRING_SLOTS = [
  "machine",
  "discovery",
  "declaration",
  "schema",
  "wiring",
] as const satisfies readonly DoctorWiringSlot[];

/** Inputs the checks share; every field falls back to the check's own default. */
export interface DoctorCheckContext {
  /** The project the checks inspect; defaults to `findProjectRoot() ?? process.cwd()`. */
  projectRoot?: string;
  /** Resources already discovered by the caller; defaults to each check's own discovery. */
  resources?: DiscoveredResource[];
  /** The doctor command's options object (`--no-database`, `--strict`, ...), forwarded to the checks that read it. */
  options?: Record<string, unknown>;
  /** Command runner for checks that probe Docker; defaults to `execAsync`. */
  exec?: ExecAsync;
  /** Process lister for the Tilt process scan; defaults to `execSync`. */
  listProcesses?: typeof execSync;
  /**
   * Lazy access to the probe cache identity; resolved only when a probe check actually runs, so a run that
   * stops before the Docker probes never pays for it.
   */
  probeEnv?: () => Promise<DoctorProbeEnvironment>;
}

export interface DoctorCheckSpec {
  /** The CheckResult.name the check reports; kept stable for the JSON doctor report. */
  name: string;
  /** The label doctor uses when the check is gated out; defaults to `name`. */
  checkName?: string;
  /** `"container-runtime"` when the check needs a live container daemon, null when files on disk suffice. */
  requires: "container-runtime" | null;
  /** Which group in the doctor run the check joins. */
  slot: DoctorWiringSlot;
  run: (context: DoctorCheckContext) => CheckResult | Promise<CheckResult>;
}

export const DOCTOR_WIRING_CHECKS: readonly DoctorCheckSpec[] = [
  {
    name: "Resource package.json",
    requires: null,
    slot: "discovery",
    run: (context) => checkResourcePackageJson(context.projectRoot),
  },
  {
    name: "Valid service.json files",
    requires: null,
    slot: "declaration",
    run: (context) => checkValidServiceJsonFiles(context.projectRoot),
  },
  {
    name: "Duplicate resource names",
    requires: null,
    slot: "declaration",
    run: (context) => checkDuplicateResourceNames(context.projectRoot),
  },
  {
    name: "Duplicate resource ports",
    requires: null,
    slot: "schema",
    run: (context) => checkDuplicateResourcePorts(context.projectRoot),
  },
  {
    name: "Literal ports",
    requires: null,
    slot: "schema",
    run: (context) => checkLiteralPorts(context.projectRoot, context.resources),
  },
  {
    name: "Claude generated-file guard",
    requires: null,
    slot: "wiring",
    run: (context) => checkClaudeGeneratedGuardHook(context.projectRoot),
  },
  {
    name: "Infrastructure frameworks",
    requires: null,
    slot: "wiring",
    run: (context) => checkInfraFrameworks(context.projectRoot),
  },
  {
    name: "Service URL ports",
    requires: null,
    slot: "wiring",
    run: (context) => checkServiceUrlPorts(context.projectRoot),
  },
  {
    name: "Frontend backend URLs",
    requires: null,
    slot: "wiring",
    run: (context) => checkFrontendBackendUrls(context.projectRoot),
  },
  {
    name: "Stack API routes",
    requires: null,
    slot: "wiring",
    run: (context) => checkSharedStackRoutes(context.projectRoot),
  },
  {
    name: "NATS broker",
    requires: null,
    slot: "wiring",
    run: (context) => checkNatsBroker(context.projectRoot),
  },
  {
    name: "Prisma 7 consistency",
    requires: null,
    slot: "wiring",
    run: (context) => checkPrismaConsistency(context.projectRoot, undefined, context.options),
  },
  {
    name: "Shared platform Postgres",
    requires: null,
    slot: "wiring",
    run: (context) => checkSharedPlatformPostgres(context.projectRoot, context.options),
  },
  {
    name: "Postgres credentials",
    requires: "container-runtime",
    slot: "wiring",
    run: (context) => checkPostgresCredentials(context.projectRoot, context.exec, context.options),
  },
  {
    name: "Migrations outside the API",
    requires: null,
    slot: "wiring",
    run: (context) => checkMigrationsInApi(context.projectRoot),
  },
  {
    name: "Health check tools",
    requires: "container-runtime",
    slot: "wiring",
    run: (context) => checkHealthCheckTools(context.projectRoot, context.exec),
  },
  {
    name: "Tilt processes",
    requires: null,
    slot: "wiring",
    run: (context) => checkTiltInstances(context.projectRoot, context.listProcesses),
  },
  {
    name: "Docker networks",
    checkName: "Docker Network Pool",
    requires: "container-runtime",
    slot: "machine",
    run: (context) =>
      checkDockerNetworkCapacity(context.exec, {
        probeEnvironment: context.probeEnv?.(),
        projectRoot: context.projectRoot,
      }),
  },
  {
    // Compose event streams a stopped stack left on the process table accumulate forever (#4854).
    name: "Compose event watchers",
    requires: "container-runtime",
    slot: "machine",
    run: () => checkComposeEventWatchers(),
  },
];

/** One runnable check for a doctor run; container-runtime rows are wrapped so the run can gate them. */
export function doctorWiringCheckFn(
  spec: DoctorCheckSpec,
  context: DoctorCheckContext,
): DoctorCheckFn {
  if (spec.requires === "container-runtime") {
    return requiresContainerRuntime(spec.checkName ?? spec.name, () => spec.run(context));
  }
  // progressName only, never checkName: a checkName in CONTAINER_DEPENDENT_CHECK_NAMES would gate a
  // check that does not need Docker, while still letting progress output name it.
  const wrapped: DoctorCheckFn = () => spec.run(context);
  wrapped.progressName = spec.checkName ?? spec.name;
  return wrapped;
}

/** The wiring checks for one slot, in table order, ready for the doctor check list. */
export function wiringChecksFor(
  slot: DoctorWiringSlot,
  context: DoctorCheckContext,
): DoctorCheckFn[] {
  return DOCTOR_WIRING_CHECKS.filter((spec) => spec.slot === slot).map((spec) =>
    doctorWiringCheckFn(spec, context),
  );
}
