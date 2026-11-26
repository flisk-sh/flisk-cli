/**
 * Starts FliskOS: turns the launch surface in `surface.ts` into a spawned process, forwards terminal signals to it
 * and, with `--json`, reads the URL it listens on out of its output. `spawn` comes in through `OsDeps`, so a test can
 * run the whole launch without a process.
 */
import { type ChildProcess, type SpawnOptions } from "node:child_process";
import { type FliskOsHost, type OsOptions, type OsReport } from "./surface.js";
/** How long `--json` waits for FliskOS to say where it listens before it gives up. */
export declare const READY_TIMEOUT_MS = 30000;
/** The JSON code for an app launch whose options require the `fliskos` command. */
export declare const FLISKOS_COMMAND_REQUIRED_CODE = "FLISKOS_COMMAND_REQUIRED";
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
/** Everything `launchFliskOs` reaches outside the process through. */
export interface OsDeps {
    host: FliskOsHost;
    spawn: SpawnFn;
    cwd: string;
    readyTimeoutMs: number;
}
/** A started FliskOS: what to report, and the exit code once it is done. */
export interface OsLaunch {
    report: OsReport;
    finished: Promise<number>;
}
/**
 * Finds FliskOS and starts it. The command runs in the foreground with the caller's terminal, and `finished` resolves
 * with its exit code. With `--json` the command's output is piped so the URL can be read from it: this resolves once
 * FliskOS listens (so the envelope can go out), and `finished` still resolves when it stops. The app opens and returns.
 */
export declare function launchFliskOs(options: OsOptions, overrides?: Partial<OsDeps>): Promise<OsLaunch>;
/**
 * Runs `flisk os`: starts FliskOS and waits for it, setting the exit code to its own. With `--json` one envelope goes
 * to stdout as soon as FliskOS is up, and the command keeps running until FliskOS stops.
 */
export declare function runOs(options: OsOptions, overrides?: Partial<OsDeps>): Promise<void>;
export {};
