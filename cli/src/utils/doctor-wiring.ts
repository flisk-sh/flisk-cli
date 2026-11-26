// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Compatibility re-exports for the existing doctor-*.ts importers and tests.
 * The checks themselves now live one concept per module under
 * `./doctor/checks/`, and their run order is the `DOCTOR_WIRING_CHECKS` table.
 */

export { checkClaudeGeneratedGuardHook } from "./doctor/checks/claude-guard.js";
export { checkComposeEventWatchers } from "./doctor/checks/compose-watchers.js";
export { checkDockerNetworkCapacity } from "./doctor/checks/docker-networks.js";
export { checkInfraFrameworks } from "./doctor/checks/frameworks.js";
export {
  checkLiteralPorts,
  findLiteralPorts,
  type LiteralPortFinding,
} from "./doctor/checks/literal-ports.js";
export { checkMigrationsInApi } from "./doctor/checks/migrations.js";
export {
  checkDuplicateResourceNames,
  checkDuplicateResourcePorts,
} from "./doctor/checks/names.js";
export { checkNatsBroker } from "./doctor/checks/nats.js";
export { checkResourcePackageJson } from "./doctor/checks/package-json.js";
export {
  checkPostgresCredentials,
  checkSharedPlatformPostgres,
} from "./doctor/checks/postgres.js";
export { checkPrismaConsistency } from "./doctor/checks/prisma.js";
export { checkSharedStackRoutes } from "./doctor/checks/routes.js";
export { checkValidServiceJsonFiles } from "./doctor/checks/service-json.js";
export type {
  DoctorCheckContext,
  DoctorCheckSpec,
  DoctorWiringSlot,
} from "./doctor/checks/table.js";
export {
  DOCTOR_WIRING_CHECKS,
  DOCTOR_WIRING_SLOTS,
  doctorWiringCheckFn,
  wiringChecksFor,
} from "./doctor/checks/table.js";
export {
  checkTiltInstances,
  listTiltInstances,
  parseTiltProcesses,
} from "./doctor/checks/tilt.js";
export {
  checkFrontendBackendUrls,
  checkServiceUrlPorts,
} from "./doctor/checks/urls.js";
