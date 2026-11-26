/** The CLI entry point the tests run, resolved once. */
export declare const fliskBin: string;
export interface FliskRunOptions {
    cwd: string;
    /** Written to the child's stdin. */
    input?: string;
    /** Merged over `cleanEnv()` and `NO_COLOR=1`. A value of `undefined` removes the variable. */
    env?: Record<string, string | undefined>;
    /** Kill the child after this many milliseconds. */
    timeout?: number;
}
export interface FliskRunResult {
    status: number;
    stdout: string;
    stderr: string;
}
/**
 * Runs `flisk <args>` in a child process and returns its exit status and output.
 * Throws when the child could not run to completion (spawn error, timeout or signal), so a test never reads
 * `status: null` as an exit code.
 */
export declare function runFlisk(args: readonly string[], options: FliskRunOptions): FliskRunResult;
