import type { CheckResult } from "../types/index.js";
import { type DoctorCheckFn } from "./doctor-runner.js";
/**
 * Live per-check progress for `flisk doctor` in plain mode. A check that never finishes keeps its
 * name on screen, so a wedged machine shows which check is stuck instead of sitting at
 * "Checking environment..." forever.
 *
 * Two modes, mirroring `flisk up` progress: an interactive terminal redraws one line listing the
 * checks still running; a pipe, CI or dumb terminal prints a line per check start and finish.
 * Progress goes to stderr so plain-mode stdout and `--json` output stay clean.
 */
export interface DoctorProgress {
    onCheckStart: (check: DoctorCheckFn) => void;
    onCheckFinish: (check: DoctorCheckFn, result?: CheckResult) => void;
    /** Clears the in-place line before the results report prints; a no-op for plain lines. */
    finish: () => void;
}
export declare function createDoctorProgress(options: {
    write: (text: string) => void;
    /** Redraw one status line in place (TTY). False prints plain lines. */
    redraw: boolean;
    /** Terminal width; the live line is cut to it so it never wraps. */
    columns?: number;
}): DoctorProgress;
