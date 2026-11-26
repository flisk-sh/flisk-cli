// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { requiresContainerRuntime } from "../../doctor-runner.js";
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
/** The slots a doctor run expands, in the order the groups appear in its check lists. */
export const DOCTOR_WIRING_SLOTS = [
    "machine",
    "discovery",
    "declaration",
    "schema",
    "wiring",
];
export const DOCTOR_WIRING_CHECKS = [
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
        run: (context) => checkDockerNetworkCapacity(context.exec, {
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
export function doctorWiringCheckFn(spec, context) {
    if (spec.requires === "container-runtime") {
        return requiresContainerRuntime(spec.checkName ?? spec.name, () => spec.run(context));
    }
    // progressName only, never checkName: a checkName in CONTAINER_DEPENDENT_CHECK_NAMES would gate a
    // check that does not need Docker, while still letting progress output name it.
    const wrapped = () => spec.run(context);
    wrapped.progressName = spec.checkName ?? spec.name;
    return wrapped;
}
/** The wiring checks for one slot, in table order, ready for the doctor check list. */
export function wiringChecksFor(slot, context) {
    return DOCTOR_WIRING_CHECKS.filter((spec) => spec.slot === slot).map((spec) => doctorWiringCheckFn(spec, context));
}
