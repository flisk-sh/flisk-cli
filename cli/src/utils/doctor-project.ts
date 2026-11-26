// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Project-level doctor checks live in doctor-project/checks/, one module per
// concept; re-exported here so existing importers keep working unchanged.
export { checkDockerBuildCache } from "./docker-build-cache.js";
export { checkDockerFileSharing } from "./docker-file-sharing.js";
export { checkResourceDiscovery } from "./doctor-project/checks/discovery.js";
export { checkFrontendDockerPreflight } from "./doctor-project/checks/docker-preflight.js";
export {
  checkGeneratedFiles,
  checkGeneratedProjectRuntimeAssets,
} from "./doctor-project/checks/generated-files.js";
export { checkStartupScripts } from "./doctor-project/checks/startup-scripts.js";
export { checkTiltIgnoredResourceNames } from "./doctor-project/checks/tiltignore-names.js";
export { checkTypeScriptTypeDependencies } from "./doctor-project/checks/type-deps.js";
export {
  checkIngressPorts,
  checkPrivateNpmRegistry,
  checkTiltResourceHealth,
  summarizeServiceProbes,
  summarizeTiltBuildError,
} from "./doctor-runtime.js";
export { checkStarlarkLoadExports } from "./doctor-starlark.js";
export { checkPublicEnvSecrets } from "./public-env-secrets.js";
