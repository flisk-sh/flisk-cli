import type { DiscoveredResource } from "../types/index.js";
import type { JsonEmitter } from "./json-output.js";
import { type NativeRunPlan, type NativeServicePlan, NativeSupervisor } from "./native-runtime.js";
export interface NativeFailure {
    name: string;
    reason: string;
    /** The service's log file, relative to the project root (`.flisk/native/logs/<name>.log`). */
    log?: string;
    logs?: string[];
    /** Last exit code of the service (127 means its program was not found), null when it never exited. */
    exitCode?: number | null;
    program?: string;
}
/** Per-URL readiness entries for `flisk up --json` in a local-process run, matching the container `data.urls` shape. */
export declare function nativeUrlChecks(services: readonly Pick<NativeServicePlan, "name" | "url">[], statuses?: ReadonlyMap<string, number>): Array<{
    service: string;
    url: string;
    didAnswer: boolean;
    status: number;
}>;
/**
 * Each failure with the last lines its service wrote (`logs`). The reason alone ("kept exiting; see its output above")
 * points at output that a `--json` or MCP caller never saw, so the cause (a missing variable, a stack trace) travels with
 * the failure. Lines come from `.flisk/native/logs`, which the supervisor masked when it wrote them; a service that
 * wrote nothing, or was never started, keeps its failure as it was. With `sinceEpochMs`, lines from earlier runs (the logs
 * are appended to) are left out.
 */
export declare function withFailureLogs(projectRoot: string, failures: NativeFailure[], sinceEpochMs?: number): NativeFailure[];
export interface NativeUpInput {
    projectRoot: string;
    /** The services to start (the selection plus its dependsOn closure); every one declares `command`. */
    selected: DiscoveredResource[];
    /** Names in `selected` that are only there because a requested service depends on them. */
    dependencies: string[];
    stackName?: string;
    only?: string[];
    /** The env file of the run (`--env-file`), else the project .env when it exists. */
    envFilePath?: string;
    dryRun?: boolean;
    quiet?: boolean;
    force?: boolean;
    emit?: JsonEmitter;
    /** Overrides for tests. */
    readyTimeoutMs?: number;
    exit?: (code: number) => never;
    /** Inferred from package.json (plain Node repo). */
    inferred?: {
        command: string;
        script: string;
    };
    /**
     * The name this checkout runs under. When set, a busy declared port is moved to a free one at run time (#4047).
     * Derived from `FLISK_CHECKOUT_NAME` or the checkout metadata in project.json when omitted.
     */
    checkoutName?: string;
    /** Port probe for the checkout remap; tests inject a deterministic one. */
    isPortAvailable?: (port: number) => Promise<boolean>;
}
/** Variables `${VAR}` in a service's env may reference: the env file of the run, overridden by the shell. */
/** What a local process starts with: the project .env (or --env-file), overridden by the shell. */
export declare function runVariables(projectRoot: string, envFilePath?: string, options?: {
    persistCheckout?: boolean;
}): Record<string, string>;
/**
 * Names (never values) of variables the .env sets that the shell overrides with a different value. A restart
 * re-reads the .env but the shell of the running `flisk up` still wins, so an edit to these has no effect.
 */
export declare function shadowedEnvKeys(projectRoot: string, envFilePath?: string, shell?: NodeJS.ProcessEnv): string[];
/**
 * Env entries that override the project .env for a local service. The .env can still hold the Docker host's
 * DATABASE_URL; a service with no database in dependsOn must read it as empty, or its /health check pings a host
 * that does not exist and never goes healthy (#4456). A service that does depend on the database keeps the value.
 */
export declare function localDatabaseEnv(dependsOn: readonly string[], databaseNames?: readonly string[], declaredEnv?: Readonly<Record<string, string>>, projectRoot?: string, options?: {
    persist?: boolean;
}): Record<string, string>;
/**
 * The checkout name a person gave (`FLISK_CHECKOUT_NAME` they set, or `worktree.name` / `checkout.name` in project.json).
 * Every checkout also has a name derived from its folder, which `flisk up` exports for interpolation; that one is not a
 * request to move ports, so a plain project with a busy port still fails (#4047).
 */
export declare function explicitCheckoutName(projectRoot: string, vars: Readonly<Record<string, string | undefined>>): string | undefined;
/** A problem `flisk up` can detect before starting anything, in both a real run and a dry run. */
export interface UpPreflightProblem {
    code: string;
    message: string;
    suggestions?: string[];
    /** Set when the problem is one service failing to start, so machine callers get the same `failures[]` as a runtime failure. */
    failure?: {
        name: string;
        exitCode: number | null;
        program?: string;
    };
}
/**
 * The static preflight shared by `flisk up` and `flisk up --dry-run`: an invalid plan (including two services on one
 * port), a binding toolchain mismatch and a command whose program is not installed. Everything here only reads, so a
 * dry run reports these problems with `ok: false` and exits 1 instead of printing a plan a real run would refuse.
 */
export declare function nativeUpPreflight(selected: readonly DiscoveredResource[], plan: {
    services: readonly NativeServicePlan[];
    errors: string[];
}): UpPreflightProblem[];
/**
 * The host-port half of the same preflight. A real run calls it only after an already-running stack has been reported,
 * since that stack legitimately holds its own ports; a dry run calls it before printing its plan.
 */
export declare function nativeUpPortPreflight(services: readonly NativeServicePlan[]): Promise<UpPreflightProblem[]>;
interface UpLock {
    /** Set when another live `flisk up` owns the project; the caller answers from the existing already-running branch. */
    busyPid?: number;
    release(): void;
}
/**
 * The state a native `flisk up` run builds up while `nativeUpSteps` runs: the input and the report/exit plumbing
 * every step needs, then each earlier step's product (`vars` from env, `plan` from plan, `supervisor` from
 * supervisor). A step ends the run by setting `finished` (a live run reported, a dry run printed) or through
 * `fail`/`failProblems` (exit 1); `stopping` tells the start step a stop already began.
 */
export interface NativeUpRun {
    readonly input: NativeUpInput;
    readonly quiet: boolean;
    readonly exit: (code: number) => never;
    /** Emit the problems as a JSON envelope, print them and exit 1. Marks the run finished first, so a test double's `exit` ends the pipeline too. */
    readonly failProblems: (problems: readonly UpPreflightProblem[], extra?: Record<string, unknown>) => never;
    /** `failProblems` for a single coded problem. */
    readonly fail: (code: string, message: string, data?: Record<string, unknown>, suggestions?: string[]) => never;
    finished: boolean;
    /** Set while `stop()` runs so a late `start()` answer is ignored. */
    stopping?: Promise<void>;
    /** The env step's product: the `.env`/`--env-file` values the shell overrides. */
    vars: Record<string, string>;
    /** The plan step's products. */
    plan: NativeRunPlan;
    databaseNames: string[];
    serviceNames: string[];
    containers: NativeServicePlan[];
    /** The banner step's product: the dependency waves the dry-run plan reports. */
    startOrder: string[][];
    /** The ports a checkout running under its own name moved to, by service (#4047). Empty for a single checkout. */
    chosenPorts: Map<string, number>;
    /** The ports service.json declares, by service, before any remap. */
    declaredPorts: Map<string, number>;
    /** The supervisor step's product. */
    supervisor?: NativeSupervisor;
    /** Held from the already-running check until the supervisor has written run state, so two starts cannot race (#3727). */
    upLock?: UpLock;
}
/** Build the run `nativeUpSteps` fills in: the input, the report/exit plumbing, and empty products. */
export declare function createNativeUpRun(input: NativeUpInput): NativeUpRun;
/** One phase of a native `flisk up`: `guard` decides whether it runs for this input; `run` does the phase. */
export interface NativeUpStep {
    readonly name: string;
    readonly guard?: (run: NativeUpRun) => boolean;
    readonly run: (run: NativeUpRun) => void | Promise<void>;
}
/** Write the names a service declares in `secrets.generate` to the env file once, before anything starts (never printed). */
export declare function nativeUpSecrets(run: NativeUpRun): void;
/**
 * The run's env: the project .env (or `--env-file`), overridden by the shell. A worktree without its gitignored
 * .env is a common source of confusing missing-key errors (#4048), so it points at another worktree's file and
 * prints the copy command, but never copies it: the values may be worktree-specific.
 */
export declare function nativeUpEnv(run: NativeUpRun): void;
/**
 * The start plans, the shared-database names the run blanks `DATABASE_URL` for, and the service/container
 * views later steps print and check. A `${VAR}` that expanded to nothing is warned about once here.
 */
export declare function nativeUpPlan(run: NativeUpRun): void;
/**
 * One preflight for both modes: a dry run must refuse the same project a real start would refuse. It only reads,
 * so the problems are collected before the dry-run plan is printed, and no generated file is written.
 */
export declare function nativeUpStaticPreflight(run: NativeUpRun): void;
export declare function nativeUpExistingRun(run: NativeUpRun): Promise<void>;
/** The start banner and the service list it prints, plus the dependency waves a dry run reports. */
export declare function nativeUpBanner(run: NativeUpRun): void;
/** A dry run's last step: refuse a taken port the same way a real run would, then emit the plan and stop. */
export declare function nativeUpDryRun(run: NativeUpRun): Promise<void>;
/** The checks only a real start runs after it passed the dry-run checks: Docker when a container needs it, then the ports. */
export declare function nativeUpRuntimePreflight(run: NativeUpRun): Promise<void>;
/**
 * Records the shared-Postgres databases this run uses, so `flisk doctor` can compare the names running checkouts
 * actually claim rather than the names a fresh `flisk up` would derive (#5132).
 */
export declare function nativeUpRunRecord(run: NativeUpRun): void;
/** The supervisor for the run: the service plans, the prefixed live output (unless quiet), and the replan a restart reads. */
export declare function nativeUpSupervisor(run: NativeUpRun): void;
/**
 * Stop the run on a signal once (the supervisor stops, then exit 0), and remove this run's run.json when the
 * process exits: if every service exits for good, nothing keeps `flisk up` alive and no run.json may be left.
 */
export declare function nativeUpGuards(run: NativeUpRun): void;
/**
 * Start the supervisor, then report: a failed start carries each failed service's last log lines and exits 1;
 * an up run emits its URLs and prints the stop hint, then stays parked on the services.
 */
export declare function nativeUpStart(run: NativeUpRun): Promise<void>;
/**
 * The native `flisk up` flow in order. `existing-run` is skipped for a dry run (it must still print its plan);
 * `dry-run` is the last step a dry run reaches, and it marks the run finished so the real-start steps never run.
 */
export declare const nativeUpSteps: readonly NativeUpStep[];
/**
 * `flisk up` for a selection where every service declares `command`: no Docker, no Compose, no Tilt and no generated files.
 * Runs `nativeUpSteps` in order and resolves only when the run ends (Ctrl+C, `flisk down`, or a failed start, which exits 1).
 */
export declare function runNativeUp(input: NativeUpInput): Promise<void>;
export {};
