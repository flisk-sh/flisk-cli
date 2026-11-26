import type { Command } from "commander";
export interface InProcessRun {
    /** What the command wrote with `console.log` and `process.stdout.write`. */
    stdout: string;
    /** What the command wrote with `console.error` and `process.stderr.write`. */
    stderr: string;
    /** The code passed to `process.exit`, or `undefined` when the command returned without exiting. */
    status: number | undefined;
}
/**
 * Runs a Commander command object in-process from `cwd` and captures its output. Use it for envelope-only and
 * flag-only cases; a case that exercises the top-level handler or the real request path stays a `runFlisk` spawn.
 * `process.exit` throws through `captureExit`, so the run stops where the command would exit. Commander keeps option
 * values between calls, so pass every flag a case needs on each call and never rely on an earlier one being absent.
 * The caller clears any discovery cache first, for example with `clearDiscoveryCache()`.
 */
export declare function runCommandInProcess(command: Command, args: readonly string[], cwd: string): Promise<InProcessRun>;
