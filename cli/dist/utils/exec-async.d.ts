import { execFile } from "node:child_process";
/** Runs a command with explicit arguments and no shell; resolves with both streams. */
export declare const execFileAsync: typeof execFile.__promisify__;
/** Runs a shell command without blocking the event loop; resolves with raw stdout. */
export type ExecAsync = (command: string, timeoutMs: number) => Promise<string>;
export declare const execAsync: ExecAsync;
/** `exec` kills a timed-out child and sets `killed`; `execSync` reports ETIMEDOUT. */
export declare function isExecTimeout(err: unknown): boolean;
