// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * Backwards-compatible facade over the doctor runtime checks.
 *
 * The implementations live in two focused modules:
 * - `./doctor/tilt-runtime.js`: Tilt resource health, stale-disable analysis and
 *   build-error summarizing.
 * - `./doctor/process.js`: host port, ingress, private-registry and container
 *   process probes, plus the service health/smoke/advertised summarizers and the
 *   health-route checks.
 *
 * Every symbol that was public here keeps this import path; callers do not change.
 */
export {
  checkHealthRoutes,
  checkHostPorts,
  checkIngressPorts,
  checkPrivateNpmRegistry,
  findForeignIngressHolders,
  findMissingHealthRoutes,
  HOST_PORT_FIXES,
  HOST_PORTS,
  INGRESS_PORTS,
  isOwnIngressContainer,
  type MissingHealthRoute,
  type PublishedPortHolder,
  parsePublishedPortHolders,
  probeContainerRuntimeError,
  probeHostPort,
  projectConfigEnablesVerdaccio,
  projectExpectsVerdaccio,
  resolveHealthPaths,
  shellQuote,
  summarizeAdvertisedProbes,
  summarizeServiceProbes,
  summarizeSmokeResults,
  toComposeProjectPrefix,
} from "./doctor/process.js";
export {
  checkTiltResourceHealth,
  describeTiltFailure,
  findStaleDisabledResources,
  getDeferredResourceNames,
  isInfraTiltFailure,
  isPortPublishFailure,
  isRegistryRelatedBuildError,
  orderTiltFailures,
  parseTiltResourceFailures,
  summarizeTiltBuildError,
  type TiltResourceFailure,
} from "./doctor/tilt-runtime.js";
