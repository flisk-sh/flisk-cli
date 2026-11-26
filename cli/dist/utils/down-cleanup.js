// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Facade for the `flisk down` cleanup jobs, which live in down-networks.ts (network pruning), down-tilt.ts (Tilt
// process lookup and stop) and down-compose.ts (running-project and Compose project discovery and stop). Callers
// keep this specifier, so `import("./down-cleanup.js")` in demo-reset and the test mocks of this module still work.
export { composeProjectsUnder, findRunningFliskProjects, isFliskComposeDir, knownProjectRoots, probeProjectIdle, projectComposeProjects, stopComposeProjectsUnder, stopProjectComposeProjects, } from "./down-compose.js";
export { fliskNetworkOwner, fliskNetworkPrefixes, listProjectNetworks, parseNetworkNames, planProjectNetworkPrune, projectNetworkNames, pruneProjectNetworks, } from "./down-networks.js";
export { findProjectTiltUpPids, lookupProjectTiltUpPids, parseProcessTable, processExecutable, readProcessTable, runAsync, stopProjectTiltUp, tiltUpPidsIn, waitForTiltUpExit, windowsTiltUpRoots, } from "./down-tilt.js";
