import type { JsonCommandResult } from "../../types/index.js";
import type { CliInvocation } from "../../utils/cli-invocation.js";
import { type CreateAnswers, type CreateStep } from "../../utils/create-plan.js";
import { type GeneratedService } from "./recovery.js";
/** One resource create actually wrote, read back from its service.json. */
export interface CreateJsonResource {
    name: string;
    type: string;
    port?: number;
}
/** The data in create's `--json` envelope, for both a plan and a completed run. */
export interface CreateJsonData {
    name: string;
    projectFolder: string;
    dryRun: boolean;
    commands: string[];
    resources: CreateJsonResource[];
    nextSteps: string[];
}
/** Builds one report from the plan and whatever the run wrote, so both routes share a shape. */
export declare function createJsonData(answers: CreateAnswers, projectDir: string, steps: CreateStep[], resources: CreateJsonResource[], next: string[], dryRun: boolean): CreateJsonData;
/** Every service.json create left behind, in a stable order agents can diff. */
export declare function createdResources(projectDir: string): CreateJsonResource[];
/** The project folder must not exist, or must be empty, so a create never overwrites anything. */
export declare function assertFolderIsFree(dir: string): void;
/**
 * Claim the project folder right before anything is written. The earlier check ran before the
 * confirmation, so this re-checks it and creates the folder without `recursive` on the last
 * segment: if another process made it in the meantime, mkdir fails (EEXIST) and create aborts
 * instead of writing into a folder it no longer owns.
 */
/** Returns true when create made the folder, false when it took over an empty folder that was already there. */
export declare function claimFolder(dir: string): boolean;
/** One line per step for the dry run and the failure report. */
export declare function renderStep(step: CreateStep): string;
/**
 * Prints the plan a `--dry-run` would execute and its JSON data, without writing anything.
 * `flisk project` and `flisk resource` run exactly these commands in the real run.
 */
export declare function dryRunResult(answers: CreateAnswers, projectDir: string, steps: CreateStep[], options?: {
    start?: boolean;
}): JsonCommandResult;
/**
 * Runs every planned step in order, marking each done. The first failure aborts with the recovery
 * message for the half-written project.
 */
export declare function runPlanSteps(invocation: CliInvocation, steps: CreateStep[], projectDir: string, createdFolder: boolean): void;
/** Splits an install command into words, treating "double quotes" as shell syntax: pip gets .[dev], not ".[dev]". */
export declare function splitCommand(command: string): string[];
/**
 * Programs that must be installed before --start can run the app. A Bun API needs a package manager and
 * Bun: the generated service starts through `<manager> run dev`, whose script calls `bun run --watch`
 * (#4678). The manager is whichever of npm, bun, pnpm, yarn the machine has, so npm alone missing is not
 * a blocker (#3609).
 */
export declare function startBlockers(answers: CreateAnswers, onPath?: (program: string) => boolean): string[];
/**
 * Writes the project's README with its run commands, next to what the generators left.
 * An existing README is kept: generators may have written one already.
 */
export declare function writeProjectReadme(projectDir: string, answers: CreateAnswers, services: GeneratedService[]): void;
/**
 * Decides whether to install and start the project now: `--start` says yes, and the local app
 * route alone gets the "install and start now?" ask (#3192) — the Docker route is started with
 * `flisk up app` and a starter points at its own README instead.
 */
export declare function resolveStartIntent(answers: CreateAnswers, interactive: boolean, requested: boolean): Promise<boolean>;
/**
 * Installs what the generators wrote. A local app installs each service with its own command
 * (npm, pip, go, cargo); a Docker project installs all services through the shared installer.
 */
export declare function installServices(projectDir: string, answers: CreateAnswers, services: GeneratedService[]): Promise<void>;
/**
 * Starts the written project: `flisk up <stack>` for a Docker project, `flisk up` for a local one,
 * after printing where to open it. Under `--json` the child's output goes to stderr so the
 * envelope stays the only stdout line.
 */
export declare function startProject(invocation: CliInvocation, projectDir: string, answers: CreateAnswers, services: GeneratedService[], options?: {
    json?: boolean;
}): void;
