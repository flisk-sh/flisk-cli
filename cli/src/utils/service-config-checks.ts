// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Re-export hub for the service-config checks; the checks live in concept
// modules under service-config-checks/ so callers keep importing this file.

// dependsOn shape and dependency cycles
export {
  checkCircularDependencies,
  checkDependsOnShape,
} from "./service-config-checks/dependencies.js";

// Custom dockerfile existence
export { checkCustomDockerfiles } from "./service-config-checks/dockerfiles.js";

// ${VAR} references in service.json env with no default and no value
export {
  type UnsetEnvReference,
  unsetEnvReferences,
  unsetEnvWarning,
} from "./service-config-checks/env-refs.js";

// service.json field validation
export { checkServiceFields } from "./service-config-checks/fields.js";

// The up-front service config gate
export { enforceServiceConfigGate } from "./service-config-checks/gate.js";

// Docker host capabilities: GPU runtime and Docker Model Runner
export {
  checkGpuRuntime,
  checkModelRunner,
  dockerModelRunnerState,
  type ModelRunnerState,
  warnModelRunner,
} from "./service-config-checks/model-runner.js";

// Declared, published and Dockerfile ports
export {
  checkDockerfilePorts,
  checkNetworkPorts,
  checkServicePorts,
  liveNetworkAddress,
} from "./service-config-checks/ports.js";

// Postgres image and volume checks
export {
  checkPostgresVolumes,
  postgresImageMajor,
  postgresVolumeWarnings,
} from "./service-config-checks/postgres.js";

// service.json schemaVersion
export { checkSchemaVersions, warnSchemaVersions } from "./service-config-checks/schema.js";

// Required and conflicting secrets
export {
  checkRequiredSecrets,
  warnSecretConflicts,
} from "./service-config-checks/secrets.js";

// Sidecars
export { checkSidecars } from "./service-config-checks/sidecars.js";

// Bind mounts
export { checkVolumes } from "./service-config-checks/volumes.js";
