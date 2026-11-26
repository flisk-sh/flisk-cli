// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { clearMigratorOutputs, getMigratorOutputPath, parseMigratorOutputFile, prepareMigratorOutputFile, } from "../migrator-output.js";
/**
 * The one-shot jobs inside a supervised run (a migrator, or a `"restart": "no"` process with no port): each
 * writes its declared outputs to a file, and its exit decides readiness instead of a probe. This module holds
 * the job-specific steps the supervisor runs at spawn and at exit.
 */
/** A job's output file is ready to be written fresh; any outputs a previous run left are forgotten. */
export function prepareJobRun(projectRoot, plan, outputs) {
    plan.env.FLISK_OUTPUT = prepareMigratorOutputFile(projectRoot, plan.name);
    outputs.delete(plan.name);
}
/**
 * Records a finished job's outputs (or clears them on failure) and returns the notes to emit: an output-file
 * error first, then the exit note. The job's `ready`/`gaveUp` flags are updated to its outcome.
 */
export function recordJobExit(projectRoot, service, code, how, outputs) {
    service.gaveUp = code !== 0;
    service.isReady = code === 0;
    const notes = [];
    if (code === 0) {
        try {
            const outputPath = getMigratorOutputPath(projectRoot, service.plan.name);
            outputs.set(service.plan.name, parseMigratorOutputFile(outputPath));
        }
        catch (err) {
            service.gaveUp = true;
            service.isReady = false;
            notes.push(`output file error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    else {
        outputs.delete(service.plan.name);
        clearMigratorOutputs(projectRoot, service.plan.name);
    }
    notes.push(service.isReady ? "finished (exit code 0)" : `${how}; a job is not restarted`);
    return notes;
}
