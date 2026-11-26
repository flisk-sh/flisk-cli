// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The native runtime (#2229): `flisk up` starts every selected `command` service as a local process and supervises it, with no
 * Docker and no Tilt. It runs in the foreground like `tilt up` does: Ctrl+C (or `flisk down` from another terminal) stops it.
 *
 * - Services start in `dependsOn` order: a service starts once everything it depends on is ready.
 * - Ready means the health URL answers (`healthCheckPath` on `port`), else the port accepts connections, else the process is
 *   still alive after a second.
 * - Output is prefixed with the service name and also appended to `.flisk/native/logs/<service>.log`.
 * - A process that exits is restarted with a growing delay, unless the service sets `"restart": "no"`. Five quick crashes in a
 *   row stop the restarts.
 * - A process that exits while something it depends on is down is not counted as crashing: it waits, and starts again once
 *   everything it depends on is ready again. One that already stopped restarting gets a fresh start then too.
 * - `.flisk/native/run.json` records the supervisor and service process ids so `flisk down` can stop a run it did not start.
 *
 * Re-export hub for the native runtime; the pieces live in concept modules under native-runtime/ so callers keep
 * importing this file:
 *
 * - plan.ts: the spawn plan (planNativeRun, NativeServicePlan, dependencyWaves, findMissingPrograms)
 * - ready.ts: the readiness probes and waits (probeServiceReady, waitForServiceReady, isPortListening)
 * - startup-error.ts: the watcher-held dead service (a startup-error line, then silence, fails the wait early)
 * - state.ts: run.json and log files (readNativeRunState, nativeServiceStates, readNativeLogLines)
 * - unhealthy.ts: which services are not healthy and why (nativeUnhealthyServices)
 * - supervision.ts: stopping and steering a run (signalGroup, stopNativeRun, requestNativeRestart)
 * - supervisor.ts: the NativeSupervisor state machine
 */

// The spawn plan: per-service plans, dependency order and the program-availability preflight
export {
  dependencyWaves,
  detachesServices,
  findMissingPrograms,
  isOneShotJob,
  localUrl,
  type NativeRunPlan,
  type NativeServicePlan,
  planNativeRun,
} from "./native-runtime/plan.js";

// Readiness: port and health probes, the ready wait, process liveness
export {
  isPortListening,
  isProcessAlive,
  probeServiceReady,
  waitForServiceReady,
} from "./native-runtime/ready.js";
// Run state and logs: run.json paths, the status query, prefixed output
export {
  formatPrefix,
  isNativeRunSupervisorAlive,
  NATIVE_DIR,
  NATIVE_STARTING_REASON,
  type NativeLogLine,
  type NativeRunState,
  nativeControlDir,
  nativeLogPath,
  nativeRunStatePath,
  nativeRuntimePorts,
  nativeRuntimeUrls,
  nativeServiceStates,
  readNativeLogLines,
  readNativeRunState,
  recordedNativeServiceNames,
} from "./native-runtime/state.js";
// Stopping and steering a run: process-group signals, down, the restart request channel
export {
  type NativeRestartResult,
  type NativeStopDeps,
  type NativeStopResult,
  requestNativeRestart,
  shellInvocation,
  signalGroup,
  stopNativeRun,
  terminateSupervisorProcess,
} from "./native-runtime/supervision.js";
// The supervisor itself: starts and restarts the planned services, writes run.json
export { NativeSupervisor, restartDelayForCrash } from "./native-runtime/supervisor.js";
// The supervisor's event contract (its record type stays internal to the runtime modules)
export type { SupervisorEvents } from "./native-runtime/types.js";
// Which services are not healthy and why, for `flisk logs --unhealthy`
export { nativeUnhealthyServices } from "./native-runtime/unhealthy.js";
