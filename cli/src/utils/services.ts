// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Discovery facade: every import of `utils/services.js` keeps working while the
// implementation lives in concept modules under `utils/services/`.

// Discovery: service.json scan, manifest parse, and cached results.
export {
  clearDiscoveryResultCache,
  discoverResources,
  discoverResourcesFromRoot,
  discoverResourcesStrict,
  discoverResourcesWithProblems,
  discoverServiceManifestPaths,
  InvalidServiceJsonError,
} from "./services/discover.js";

// Presentation metadata: display fields for resources and stacks, with a TTL cache.
export { clearMetadataCache, getResourceMetadata, getStackMetadata } from "./services/metadata.js";

// Stack queries over discovered resources.
export {
  discoverStackNames,
  discoverStacks,
  getAllStacks,
  getResourcesForStack,
  stackExists,
} from "./services/stacks.js";

// Warn-once printing and the `--json` skipped-files envelope.
export {
  resetPrintedServiceWarnings,
  skippedServiceFiles,
  warnAboutSkippedFiles,
} from "./services/warnings.js";
