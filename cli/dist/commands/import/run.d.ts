import { type SpawnOptions, spawn } from "node:child_process";
import type { Command } from "commander";
import { JsonCommandError } from "../../utils/json-command.js";
import { type ImportPlannedService, type ImportPlanSkip } from "./plan.js";
import { type SkippedImportSource } from "./skipped-sources.js";
import { importCoverageSummary } from "./summary.js";
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;
/**
 * The directory `flisk import` ran on: the first argument that is not a flag, or "." when none
 * is. A `tiltfile` import has no Compose file to read, so it gets no directory.
 */
export declare function importDirArg(forwardedArgs: string[]): string | null;
/**
 * Runs flisk-import with the caller's terminal and resolves to its exit code. stdout is piped and
 * passed through, so the coverage summary can be printed after the importer's own output.
 */
export declare function runImport(args: string[], spawnFn?: SpawnFn, getVersionFn?: () => string): Promise<number>;
/** What flisk-import printed and how it exited, for `flisk import --json`. */
export interface ImportRun {
    exitCode: number;
    stdout: string;
    stderr: string;
}
/**
 * Runs flisk-import with its output piped instead of the caller's terminal and no stdin, so it can never prompt, and
 * resolves to what it printed and its exit code. A refusal of the core version gate or a missing package runner is a run too.
 */
export declare function runImportCaptured(args: string[], spawnFn?: SpawnFn, getVersionFn?: () => string): Promise<ImportRun>;
/** The structured part of an import report: the importer's plan, parsed out of its printed text. */
interface ImportPlanFields {
    services: ImportPlannedService[];
    /** Sources the import left out: the importer's own skips, plus sibling Procfiles it does not read (#5033). */
    skipped: ImportPlanSkip[];
    planned: string[];
}
/**
 * What `flisk import --json` reports. `written` lists the service.json files the importer says it wrote; `services`,
 * `skipped` and `planned` are the importer's plan as fields, so a caller does not parse `output`.
 */
export interface ImportReport extends ImportPlanFields {
    dir: string;
    dryRun: boolean;
    force: boolean;
    written: string[];
    output: string;
    /** The dropped / approximated / by-design summary (#3108), present when it has an entry. */
    coverage?: ReturnType<typeof importCoverageSummary>;
}
/**
 * What `flisk import tiltfile --json` reports. `path` is the path argument as given (`Tiltfile` when omitted); `written`
 * lists the files the importer says it wrote (`.flisk/project.json`). `services` is empty: a Tiltfile registers
 * orchestration instead of mapping services.
 */
export interface TiltfileImportReport extends ImportPlanFields {
    path: string;
    dryRun: boolean;
    force: boolean;
    written: string[];
    output: string;
}
/** The report of a successful run, read from the forwarded arguments and the importer's "  wrote <path>" lines. */
export declare function importReport(forwardedArgs: string[], run: ImportRun, skipped?: SkippedImportSource[]): ImportReport | TiltfileImportReport;
/**
 * The error of a failed run: the importer's "Error: ..." line (or whatever it printed last) and its "-> ..." hints. The
 * importer prints "Nothing to import: ..." on stdout, so stdout is read when stderr says nothing.
 */
export declare function importFailure(run: ImportRun, commandName?: string): JsonCommandError;
export interface ImportOptions {
    yes?: boolean;
    force?: boolean;
    dryRun?: boolean;
    json?: boolean;
    agentSkills?: boolean;
}
export declare function resolveImportOptions(options?: ImportOptions, cmd?: Command): ImportOptions;
/**
 * After a successful Compose import, write the same AGENTS.md and Flisk agent skills `flisk project`
 * writes, so a coding agent opened in the imported project knows to run it with `flisk up` (#3213).
 * Skipped on a dry run, with --no-agent-skills, or when the run left no `.flisk/project.json` (nothing
 * was imported). Never overwrites: when AGENTS.md already exists, one stderr line suggests adding the
 * Flisk section instead. A failure here is a warning, not an exit. Returns the paths written.
 */
export declare function installImportAgentSkills(dir: string, options?: {
    agentSkills?: boolean;
    dryRun?: boolean;
    quiet?: boolean;
}): string[];
/**
 * Preserves a Compose `command` on a service that also has `build:` (#3060).
 * In Compose, a service can define both `build:` and `command:`. Flisk maps container
 * runtime arguments to `container.command` so the Compose generator passes it through.
 */
export declare function carryOverBuildCommand(manifest: Record<string, unknown>, command?: string | string[]): Record<string, unknown>;
/**
 * Normalizes any written service.json files where build and command were declared,
 * ensuring container.command is populated.
 */
export declare function syncImportedManifestCommands(writtenPaths: string[]): void;
/**
 * How the import's positional directory argument checks out before the importer runs: `ok` to forward as given,
 * `rewrite` to pass the Compose file's parent directory instead, or `error` to refuse with a hint.
 */
export type ImportDirCheck = {
    status: "ok";
} | {
    status: "rewrite";
    index: number;
    dir: string;
} | {
    status: "error";
    message: string;
    suggestion: string;
};
/**
 * Checks the directory argument before the importer runs, which answers every non-directory with the same
 * "is not a directory" line. A missing path is told apart (`<path> does not exist`), a Compose file is honoured as
 * its parent directory, and any other file is refused with the directory to pass instead. The tiltfile positional
 * is a file on purpose and is never checked.
 */
export declare function checkImportDirArg(args: string[], commandName?: string, statFn?: (path: string) => {
    isDirectory(): boolean;
} | undefined): ImportDirCheck;
/**
 * Runs `flisk import` (and its `compose` / `tiltfile` subcommands). With `--json` the importer runs captured and never
 * prompts; otherwise it inherits the terminal, and a run that would write is refused when there is no terminal to ask in.
 * Sets `process.exitCode` to the importer's exit code, or 1 for a refusal.
 */
export declare function executeImport(args: string[], options?: ImportOptions, commandName?: string): Promise<void>;
/**
 * Without a terminal the importer cannot ask its (Y/n) question: it wrote nothing and exited 0, which a coding agent or CI
 * job reads as success. A run that would write, with no `--yes` and no stdin TTY, is refused with exit 1 before it starts.
 */
export declare function nonInteractiveRefusal(forwardedArgs: string[], commandName?: string, isTTY?: boolean): string | null;
export {};
