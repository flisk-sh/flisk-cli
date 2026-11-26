import type { NativeServicePlan } from "./plan.js";
import type { RunningService } from "./types.js";
/**
 * The one-shot jobs inside a supervised run (a migrator, or a `"restart": "no"` process with no port): each
 * writes its declared outputs to a file, and its exit decides readiness instead of a probe. This module holds
 * the job-specific steps the supervisor runs at spawn and at exit.
 */
/** A job's output file is ready to be written fresh; any outputs a previous run left are forgotten. */
export declare function prepareJobRun(projectRoot: string, plan: NativeServicePlan, outputs: Map<string, Record<string, string>>): void;
/**
 * Records a finished job's outputs (or clears them on failure) and returns the notes to emit: an output-file
 * error first, then the exit note. The job's `ready`/`gaveUp` flags are updated to its outcome.
 */
export declare function recordJobExit(projectRoot: string, service: RunningService, code: number | null, how: string, outputs: Map<string, Record<string, string>>): string[];
