import type { DoctorOptions } from "./context.js";
/**
 * The `flisk doctor` run: validate the flags, print the intro, hand the native-Windows and
 * WebContainer hosts their early reports, run `--fix` first when asked, expand the check
 * table for the run context, run the machine and project sections, then print the JSON or
 * text report (with the same secret masking in both).
 */
export declare function runDoctor(options: DoctorOptions): Promise<void>;
