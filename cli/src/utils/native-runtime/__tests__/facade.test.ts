// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  NativeLogLine,
  NativeRestartResult,
  NativeRunPlan,
  NativeRunState,
  NativeServicePlan,
  NativeStopDeps,
  NativeStopResult,
  SupervisorEvents,
} from "../../native-runtime.js";
import * as facade from "../../native-runtime.js";
import * as planModule from "../plan.js";
import * as readyModule from "../ready.js";
import * as stateModule from "../state.js";
import * as supervisionModule from "../supervision.js";
import * as supervisorModule from "../supervisor.js";
import * as unhealthyModule from "../unhealthy.js";

// Every value the facade must re-export for existing consumers (utils/native-runtime.ts has been the
// import path since the native runtime landed). A dropped binding fails this list, not a consumer's run.
const EXPECTED_VALUE_EXPORTS = [
  "dependencyWaves",
  "detachesServices",
  "findMissingPrograms",
  "formatPrefix",
  "isNativeRunSupervisorAlive",
  "isOneShotJob",
  "isPortListening",
  "isProcessAlive",
  "localUrl",
  "NATIVE_DIR",
  "NATIVE_STARTING_REASON",
  "nativeControlDir",
  "nativeLogPath",
  "nativeRunStatePath",
  "nativeRuntimePorts",
  "nativeRuntimeUrls",
  "nativeServiceStates",
  "nativeUnhealthyServices",
  "NativeSupervisor",
  "planNativeRun",
  "probeServiceReady",
  "readNativeLogLines",
  "readNativeRunState",
  "recordedNativeServiceNames",
  "requestNativeRestart",
  "restartDelayForCrash",
  "shellInvocation",
  "signalGroup",
  "stopNativeRun",
  "terminateSupervisorProcess",
  "waitForServiceReady",
];

describe("native-runtime facade", () => {
  it("re-exports exactly the public value surface", () => {
    expect(Object.keys(facade).sort()).toEqual([...EXPECTED_VALUE_EXPORTS].sort());
  });

  it("re-exports each cluster's own bindings, not wrappers", () => {
    // plan.ts
    expect(facade.dependencyWaves).toBe(planModule.dependencyWaves);
    expect(facade.detachesServices).toBe(planModule.detachesServices);
    expect(facade.findMissingPrograms).toBe(planModule.findMissingPrograms);
    expect(facade.isOneShotJob).toBe(planModule.isOneShotJob);
    expect(facade.localUrl).toBe(planModule.localUrl);
    expect(facade.planNativeRun).toBe(planModule.planNativeRun);
    // ready.ts
    expect(facade.isPortListening).toBe(readyModule.isPortListening);
    expect(facade.isProcessAlive).toBe(readyModule.isProcessAlive);
    expect(facade.probeServiceReady).toBe(readyModule.probeServiceReady);
    expect(facade.waitForServiceReady).toBe(readyModule.waitForServiceReady);
    // state.ts
    expect(facade.formatPrefix).toBe(stateModule.formatPrefix);
    expect(facade.isNativeRunSupervisorAlive).toBe(stateModule.isNativeRunSupervisorAlive);
    expect(facade.NATIVE_DIR).toBe(stateModule.NATIVE_DIR);
    expect(facade.nativeControlDir).toBe(stateModule.nativeControlDir);
    expect(facade.nativeLogPath).toBe(stateModule.nativeLogPath);
    expect(facade.nativeRunStatePath).toBe(stateModule.nativeRunStatePath);
    expect(facade.nativeServiceStates).toBe(stateModule.nativeServiceStates);
    expect(facade.readNativeLogLines).toBe(stateModule.readNativeLogLines);
    expect(facade.readNativeRunState).toBe(stateModule.readNativeRunState);
    // supervision.ts
    expect(facade.requestNativeRestart).toBe(supervisionModule.requestNativeRestart);
    expect(facade.shellInvocation).toBe(supervisionModule.shellInvocation);
    expect(facade.signalGroup).toBe(supervisionModule.signalGroup);
    expect(facade.stopNativeRun).toBe(supervisionModule.stopNativeRun);
    expect(facade.terminateSupervisorProcess).toBe(supervisionModule.terminateSupervisorProcess);
    // supervisor.ts
    expect(facade.NativeSupervisor).toBe(supervisorModule.NativeSupervisor);
    // unhealthy.ts
    expect(facade.nativeUnhealthyServices).toBe(unhealthyModule.nativeUnhealthyServices);
  });

  it("re-exports the public types (compile-time: a missing one fails typecheck)", () => {
    const types: {
      plan?: NativeServicePlan;
      run?: NativeRunPlan;
      line?: NativeLogLine;
      state?: NativeRunState;
      restart?: NativeRestartResult;
      stopDeps?: NativeStopDeps;
      stopResult?: NativeStopResult;
      events?: SupervisorEvents;
    } = {};
    expect(types).toEqual({});
  });
});
