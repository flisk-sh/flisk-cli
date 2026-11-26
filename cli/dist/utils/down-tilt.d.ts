export type CommandRunner = (command: string, args: string[]) => string;
export type AsyncCommandRunner = (command: string, args: string[]) => Promise<string>;
export declare const runAsync: AsyncCommandRunner;
export interface ProcessEntry {
    pid: number;
    command: string;
}
/**
 * The one process-table read used by every down discovery path. Throws when `ps` cannot be read so callers can choose
 * between "no process" and "could not look"; the Windows caller treats the platform as having no process table.
 */
export declare function readProcessTable(platform?: NodeJS.Platform, commandRunner?: CommandRunner): ProcessEntry[];
export declare function parseProcessTable(output: string): ProcessEntry[];
/** The program a command line starts, without its folders. */
export declare function processExecutable(command: string): string;
/** Project roots with a `tilt up` on their Flisk Tiltfile among the Windows processes (duplicates kept out). */
export declare function windowsTiltUpRoots(commandRunner?: CommandRunner): string[];
/**
 * Like {@link findProjectTiltUpPids}, but null when the process list cannot be read (`ps` or PowerShell fails),
 * so a caller can tell "no tilt up" from "could not look".
 */
export declare function lookupProjectTiltUpPids(tiltfilePath: string, platform?: NodeJS.Platform, commandRunner?: CommandRunner): number[] | null;
export declare function tiltUpPidsIn(entries: ProcessEntry[], tiltfilePath: string): number[];
/**
 * PIDs of `tilt up` processes started for this project's Tiltfile. Matching on the Tiltfile path keeps another
 * project's Tilt (or a Tilt the user started by hand) untouched.
 */
export declare function findProjectTiltUpPids(tiltfilePath: string, platform?: NodeJS.Platform, commandRunner?: CommandRunner): number[];
export declare function stopProjectTiltUp(tiltfilePath: string, platform?: NodeJS.Platform, commandRunner?: CommandRunner): number[];
/** Wait (up to `timeoutMs`) for the `tilt up` processes to exit after TERM, so `tilt down` does not race a live Tilt. */
export declare function waitForTiltUpExit(tiltfilePath: string, timeoutMs?: number, findPids?: (tiltfilePath: string) => number[]): Promise<boolean>;
