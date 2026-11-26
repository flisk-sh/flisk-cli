import { type SpawnSyncReturns } from "node:child_process";
/** Per run, in milliseconds. A cold Tilt start under full-suite load takes several seconds. */
export declare const TILT_TIMEOUT_MS = 60000;
export declare const MISSING_TILT_MESSAGE = "Tilt was not found on PATH. Install Tilt to run the Starlark tests, or leave FLISK_REQUIRE_TILT unset to skip them.";
/** Whether `tilt version` runs. Exported so a test can stub the lookup. */
export declare function probeTilt(): boolean;
/**
 * Returns whether Tilt is available. When it is missing, returns false and logs one warning, or throws when
 * `FLISK_REQUIRE_TILT=1` (CI), so the suites that call this skip locally and fail in CI.
 */
export declare function resolveTiltAvailability(probe?: () => boolean, env?: NodeJS.ProcessEnv, warn?: (message: string) => void): boolean;
/**
 * Whether the Starlark suites run. Resolved on first use, not at import, so importing this folder from a test that
 * does not need Tilt never spawns `tilt` or throws. The Starlark suites use `describe.skipIf(!tiltAvailable())`.
 */
export declare function tiltAvailable(): boolean;
/** A path under the engine folder, for `load()` in a snippet. */
export declare function engineFile(...segments: string[]): string;
export interface StarlarkOptions {
    /** The Tiltfile body. It runs in a scratch project, so it usually starts with a `load(...)` of `file`. */
    args: string;
    /** Merged over `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Adds `--verbose`, so `print()` output reaches the output. */
    verbose?: boolean;
    /** Files written into the scratch project before the run, keyed by relative path. */
    files?: Record<string, string>;
    /** How long the run may take, in milliseconds (Default: `TILT_TIMEOUT_MS`). */
    timeoutMs?: number;
}
export interface StarlarkRun extends SpawnSyncReturns<string> {
    /** The scratch project the Tiltfile ran in. It is removed after the test. */
    dir: string;
}
/**
 * Kills what is left of a tilt run's process group, such as a server tilt forked. Windows has no process groups, and
 * the timeout there ends tilt with TerminateProcess, which cannot be trapped, so this does nothing on Windows.
 */
export declare function killProcessGroup(pid: number, kill?: typeof process.kill): void;
/**
 * Runs `args` as a Tiltfile in a scratch project and returns the exit status and output. `file` is the module under
 * test: it must exist and is named in the error when the run cannot start. A failed `fail(...)` check is a
 * non-zero status, which the caller asserts on, so this does not throw for it.
 */
export declare function evaluateStarlark(file: string, options: StarlarkOptions): StarlarkRun;
