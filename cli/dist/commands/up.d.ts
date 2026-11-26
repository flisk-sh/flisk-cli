import { Command } from "commander";
export type { NativeUpSelection, ServiceHealth, UpOptions, UpRun, UpStep } from "./up-steps.js";
export { checkStackUrls, DRIFT_EXIT_CODE, defaultDockerReachable, driftReport, enforceDriftGate, enforceVersionFloor, fastNoopFlags, formatUpSuccess, hostUpRefusal, nativeWindowsUpRefusal, printFastNoopResult, selectNativeRun, selectRunEnvFile, toUpError, unknownServiceSuggestions, upError, waitForTiltUi, waitForTiltUnlessStartupFailed, } from "./up-steps.js";
export declare const upCommand: Command;
