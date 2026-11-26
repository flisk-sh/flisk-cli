import { type ChildProcess } from "node:child_process";
import type { ServiceRuntimeState } from "../../../types/index.js";
import type { McpToolResult } from "../../server.js";
/** What the supervising `flisk up` has on record while it is still starting the local processes of a project. */
export interface NativeUpSnapshot {
    services: Record<string, ServiceRuntimeState>;
    /** The last lines (own output, secrets masked) of each service that is not ready. */
    logs: Record<string, string[]>;
}
export declare function readNativeUpSnapshot(projectDir: string, since: number): NativeUpSnapshot | null;
/**
 * The state of a start, in one word. `starting`: launched, readiness not confirmed yet. `ready`: every local process passed its
 * readiness check. `failed`: a process exited or gave up, or `flisk up` ended. `timeout`: readiness was not established within
 * the wait the caller asked for with waitForReady (the stack keeps starting).
 */
export type UpState = "starting" | "ready" | "failed" | "timeout";
export interface UpDeps {
    /** Starts `flisk up` detached, with output going to a log file. */
    spawnUp: (args: string[], logFile: string, cwd?: string) => ChildProcess;
    readLog: (logFile: string) => string;
    /** What the supervising `flisk up` has on record for the local processes of the project at this path (native runs only). */
    nativeSnapshot?: (projectDir: string, since: number) => NativeUpSnapshot | null;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    logFile: () => string;
}
export declare const defaultUpDeps: UpDeps;
/** The `up` tool's arguments, bound to the `flisk up` spec. */
export declare const upArgs: import("../../spec-args.js").ArgSpec;
export declare function buildUpArgs(args: Record<string, unknown>): string[];
/**
 * Starts the stack detached and returns without waiting for it to be ready (a build can take minutes, longer than a tool
 * call may last). It watches only for an early result, which is how a refusal such as UNKNOWN_SERVICE, TILT_ALREADY_RUNNING
 * or an unsupported host arrives; otherwise the caller polls the `status` tool for `data.tilt.readiness`.
 */
export declare function startUp(args: Record<string, unknown>, deps?: UpDeps): Promise<McpToolResult>;
/** `up` does not go through the CLI-runner: startUp drives its own detached child and needs the up dependencies. */
export declare const upRun: ({ up }: {
    up: UpDeps;
}) => (args: Record<string, unknown>) => Promise<McpToolResult>;
