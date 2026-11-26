import type { DiscoveredResource, HostPortPlan, LocalOverride } from "../types/index.js";
import { type CheckoutIdentity } from "../utils/checkout-id.js";
import { type SelectedEnvFile } from "../utils/env-selection.js";
import { FliskError } from "../utils/errors.js";
import { type JsonEmitter, type JsonError } from "../utils/json-output.js";
import { nativeWindowsStackRefusal } from "../utils/native-windows.js";
import { type ProfileSelection } from "../utils/profiles.js";
import { discoverResourcesWithProblems, discoverStacks } from "../utils/services.js";
import { buildSmokePlans } from "../utils/smoke.js";
import { type ProjectTiltPorts } from "../utils/tilt-port-owner.js";
import { secondUpAction } from "../utils/tilt-startup.js";
import { type FastNoopFlags, tryFastNoop } from "../utils/up-fast-noop.js";
import { type ServiceTiming } from "../utils/up-timings.js";
import { checkPrintedUrls, type UrlCheck } from "../utils/url-check.js";
export interface ServiceHealth {
    name: string;
    status: "ready" | "failed" | "starting";
    /** True when the service's health check is optional (`healthCheck.required: false`). */
    optional?: boolean;
    url?: string;
    /** The health URL to print; null for a service without one (a bring-your-own service with no healthCheckPath). */
    healthUrl?: string | null;
}
export declare function formatUpSuccess(port: number, options?: {
    appUrls?: string[];
    serviceHealth?: ServiceHealth[];
    showLogsHint?: boolean;
}): string[];
/**
 * The native Windows boundary for a command that starts a stack.
 *
 * It lives here because `flisk up` is where the boundary has always been enforced; the
 * one-command demo flow refuses with the same message before it clones or installs anything.
 */
export declare const nativeWindowsUpRefusal: typeof nativeWindowsStackRefusal;
/** Why `flisk up` cannot work on this host, or null when it may proceed. Docker reachability is only probed in container hosts. */
export declare function hostUpRefusal(host?: import("../utils/agent-host.js").HostInfo, dockerReachable?: () => Promise<boolean>): Promise<string | null>;
export declare function defaultDockerReachable(): Promise<boolean>;
/** Exit status for `flisk up` when generated files no longer match service.json / project.json. */
export declare const DRIFT_EXIT_CODE = 2;
/**
 * Generated service files edited by hand. Only these block `flisk up`: when service.json itself changed, `flisk up` regenerates
 * the outputs, so stale outputs are the normal edit-then-up loop and not drift.
 */
export declare function driftReport(projectRoot: string, resources?: DiscoveredResource[]): string[] | null;
/**
 * Runs before Tilt is started: exits with DRIFT_EXIT_CODE on drift unless `ignoreDrift` is set. With `ignoreDrift` the
 * warning is printed every time, whether or not anything drifted, because the check is skipped and cannot tell.
 */
export declare function enforceDriftGate(projectRoot: string, options: {
    ignoreDrift?: boolean;
    onDrift?: (message: string) => void;
    resources?: DiscoveredResource[];
}, exit?: (code: number) => never): void;
/**
 * Checks the project's CLI version requirements before anything starts.
 * Enforces both minFliskVersion and pinnedFliskVersion, including under --dry-run.
 * Kept as a compatibility wrapper for existing callers and tests.
 */
export declare function enforceVersionFloor(projectRoot: string, options: {
    ignoreVersion?: boolean;
    onFail?: (message: string, status: "malformed" | "too-old" | "mismatch") => void;
}, currentVersion?: string, exit?: (code: number) => never): void;
/**
 * Waits for Tilt to exit, unless startup has already failed. A readiness failure reports and exits 1 at once: Tilt keeps
 * running (`flisk down` stops it), so waiting for its exit would hang the command.
 */
export declare function waitForTiltUnlessStartupFailed<T>(tiltRun: Promise<T>, startupFailure: Promise<void>, exit?: (code: number) => never): Promise<T>;
export declare function waitForTiltUi(port: number, timeoutMs?: number): Promise<boolean>;
/**
 * The env file of the run. `flisk up --env-file <path>` replaces the project `.env` for the run, so the
 * file is resolved, read and checked before anything is written or started. Without the option the
 * project `.env` stays the env file of the run, exactly as before.
 *
 * @throws FliskError when the file cannot be used; the run stops before it starts
 */
export declare function selectRunEnvFile(projectRoot: string | null, requested: string | undefined): SelectedEnvFile | undefined;
/**
 * Shared error builder for `up --json` (#4522).
 * Ensures `suggestions` is always a present string[] array.
 */
export declare function upError(code: string, message: string, suggestions?: readonly string[]): JsonError;
/**
 * Ensures UNKNOWN_SERVICE carries helpful suggestions: closest matches when available,
 * otherwise the list of valid service names (#4522).
 */
export declare function unknownServiceSuggestions(unknown: readonly string[], validNames: readonly string[], closestSuggestions?: readonly string[]): string[];
/** Converts any thrown or returned error to an up MachineError with suggestions array (#4522). */
export declare function toUpError(error: unknown): JsonError;
/** A selection `flisk up` runs as local processes. */
export interface NativeUpSelection {
    projectRoot: string;
    /** No .flisk/project.json yet: `flisk up` adopts the directory as a project. */
    isNewProject: boolean;
    all: DiscoveredResource[];
    selected: DiscoveredResource[];
    dependencies: string[];
    /** Fields applied from `service.local.json` files for this local-process run. */
    overrides: LocalOverride[];
}
/**
 * Decides whether `flisk up` runs the selection as local processes (#2229). Returns null for today's Docker + Tilt path, which
 * a project without any `command` service always takes. Outside a project, a directory whose services all declare `command`
 * becomes the project. A project whose .flisk/project.json selects its own Tiltfile (`flisk import tiltfile`) also returns null:
 * Tilt runs that Tiltfile through the generated wrapper, whatever its services declare. Refuses (through `fail`) an unknown
 * stack or service, an invalid service.json, and a run that would mix native and container services.
 */
export declare function selectNativeRun(stackName: string | undefined, only: string[] | undefined, fail: (code: string, message: string, suggestions?: string[], exitCode?: number) => never, cwd?: string): NativeUpSelection | null;
/** Flags and environment of this run, for the fast no-op decision. */
export declare function fastNoopFlags(options: Record<string, unknown>, stackName: string | undefined, configuredTiltPort: number | undefined): FastNoopFlags;
/**
 * The already-up answer, in both output modes. `--wait` calls it after its child has exited; an attached `up` calls it
 * before any prerequisite, write or Tilt command. The URLs are printed so a script sees the same addresses a normal
 * start prints.
 */
export declare function printFastNoopResult(result: NonNullable<Awaited<ReturnType<typeof tryFastNoop>>>, options: {
    json?: boolean;
    quiet?: boolean;
}, emit?: JsonEmitter): void;
/**
 * Probes every URL `flisk up` prints for the started services (#3211): "ready" means each one answers. A URL that does not is
 * diagnosed from the Tilt resource (exited) and its logs (a missing environment variable).
 */
export declare function checkStackUrls(tiltPort: number, resources: readonly DiscoveredResource[], ingressPort: number | undefined, deferred: ReadonlySet<string>, deps?: {
    check?: typeof checkPrintedUrls;
}): Promise<UrlCheck[]>;
/** The flags `flisk up` parses; the pipeline steps read them and `json-quiet` updates `quiet`. */
export type UpOptions = {
    verbose: boolean;
    quiet: boolean;
    dryRun: boolean;
    force: boolean;
    ignoreDrift: boolean;
    ignoreVersion: boolean;
    database?: boolean;
    gateway?: boolean;
    only?: string[];
    profile?: string[];
    envFile?: string;
    json: boolean;
    wait: boolean;
    waitTimeout?: string;
    /** The project --project pointed at, resolved and entered by the command's preAction hook. */
    project?: string;
};
/** One ordered phase of `flisk up`: `guard` decides whether it runs for this run; `run` does the phase. */
export interface UpStep {
    readonly name: string;
    readonly guard?: (run: UpRun) => boolean;
    readonly run: (run: UpRun) => void | Promise<void>;
}
/**
 * The state a `flisk up` run builds while `upSteps` (and, for a container stack, `containerSteps`) execute: the input
 * and the report/exit plumbing every step needs, then each earlier step's product. A step ends the run by setting
 * `didFinish` (a native run started, a dry run printed its plan, an already-running stack was reported) or through
 * `fail`/`failError`, the one refusal path every step shares: emit the --json error and exit. It replaces the ~20
 * per-step copies of "emit + showErrorAndExit / error.exit / process.exit" the single action used to repeat (#4862).
 */
export interface UpRun {
    /** The stack or git-URL argument, cleared to undefined once a cloned repository is entered. */
    stackName: string | undefined;
    readonly options: UpOptions;
    /** The raw --json envelope writer; undefined in human mode. */
    readonly baseEmit: JsonEmitter | undefined;
    /** The emitter steps use: folds this run's diskWarning and projectWarnings into every successful result. */
    emit: JsonEmitter | undefined;
    /** Non-blocking findings (schema, secret conflicts, optional health checks) carried into the --json result. */
    readonly projectWarnings: string[];
    /** The low-disk field the disk guard produced, reported with the --json result. */
    diskWarning: Record<string, unknown> | undefined;
    /** The one refusal path: emit the error's machine form, print it and exit. */
    fail(code: string, message: string, suggestions?: string[], exitCode?: number): never;
    /** `fail` for a FliskError: emit its machine form, then display it and exit with its own code. */
    failError(error: FliskError): never;
    /** The disk guard as configured for this run; a dry run skips it. */
    guardDisk(isDockerRun: boolean): void;
    /** Set by a step that ended the run without an error; the pipeline stops before the next step. */
    didFinish: boolean;
    /** The TILT_PORT the run was configured with, when the value parsed. */
    configuredTiltPort?: number;
    /** The flags/environment snapshot the fast no-op decision and the run-state record share. */
    fastFlags?: FastNoopFlags;
    /** The project root the version-floor step found, reused by the project-required step. */
    versionRoot: string | null;
    /** True when a declared repository was cloned this run: discovery must run again below. */
    hasClonedRepos: boolean;
    /** The project the run refuses to leave, resolved before any Docker or Tilt check (#4282). */
    envFileRoot?: string;
    /** The env file of the run selected by --env-file. */
    envFileSelection?: SelectedEnvFile;
    /** The project root the schema gate read, reused by discovery when nothing was cloned meanwhile. */
    schemaRoot: string | null;
    /** The discovery the schema gate already did. */
    initialDiscovery?: ReturnType<typeof discoverResourcesWithProblems>;
    foundRoot: string | null;
    projectRoot: string;
    gatewayEnabled: boolean;
    /** The discovered resources the container run works on (`discoveredResources`). */
    resources: DiscoveredResource[];
    stacks?: ReturnType<typeof discoverStacks>;
    stackNames: string[];
    /** Declared repository dirs a dry run has not cloned yet; their services are pending, not absent. */
    pendingClone: string[];
    /** The empty-project verdict the selection check and the start step share (#4966). */
    noResources: boolean;
    /** dependsOn names that are no service, stack or shared Postgres; dropped by the Tiltfile, reported by the dry run. */
    unknownDependsOn: {
        resource: string;
        name: string;
    }[];
    /** frontend backendName values that are no service of this project. */
    unknownBackends: {
        resource: string;
        name: string;
    }[];
    /** The real-run port claimer; undefined on a dry run, which holds nothing. */
    claimPort?: (port: number) => boolean;
    /** The Tilt UI port the last `flisk up` saved, so a moved Tilt is found again (#4165). */
    savedTiltPort: number | null;
    hostPortPlan?: HostPortPlan;
    /** The services the run starts after the stack, --only and profile selection. */
    servicesToStart: DiscoveredResource[];
    /** Names in the selection only because a requested service depends on them. */
    dependencyNames: string[];
    /** The names the Tilt invocation focuses. */
    focusServiceNames: string[];
    stackDescription: string;
    serviceNames: string[];
    profileSelection?: ProfileSelection;
    /** The checkout this run names; null on a dry run, which persists nothing (#4697). */
    checkoutIdentity: CheckoutIdentity | null;
    /** The collision suffix claimCheckoutHost gave this checkout, applied once the start is real. */
    hostSuffix: string | null;
    tiltArgs: string[];
    dryRunCommand: string;
    /** The port a running Tilt is watched on: the configured port, else the default. */
    watchedPort: number;
    /** The ports `findProjectTiltPorts` probed. */
    candidatePorts: number[];
    tiltScan?: ProjectTiltPorts;
    /** True when --force replaces this project's Tilt (never another project's). */
    force: boolean;
    /** The second-up decision the port scan produced. */
    decision?: ReturnType<typeof secondUpAction>;
    /** The port this run's Tilt is started on. */
    tiltPort: number;
    smokePlans: ReturnType<typeof buildSmokePlans>;
    /** The Tilt UI answered; readiness itself is reported by the later steps. */
    uiReady: boolean;
    /** The --json readiness wait saw every non-deferred resource built and running. */
    jsonReady: boolean;
    /** What Tilt actually enabled, for the --json result. */
    startedServices: string[];
    startedDependencies: string[];
    /** The per-URL checks the --json result carries. */
    urlChecks?: UrlCheck[];
    /** Per-service start-to-ready times for the --json result (#4129). */
    timings?: ServiceTiming[];
    /** A readiness or URL failure the report already showed; the run exits 1 after Tilt is awaited. */
    startupFailed: boolean;
    smokeFailed: boolean;
    printedSuccess: boolean;
    /** Resolves when the startup report saw a failure; `waitForTiltUnlessStartupFailed` exits then. */
    startupFailure: Promise<void>;
    signalStartupFailed(): void;
}
/**
 * Builds the run `upSteps` fills in: the input, the --json/human report plumbing, the one exit primitive
 * every step's refusal goes through, and the products initialised empty.
 */
export declare function createUpRun(stackName: string | undefined, options: UpOptions): UpRun;
/**
 * The `flisk up` pipeline in order: the gates every run passes before a runtime is chosen, the runtime branches that
 * end the run early (git clone, --wait, fast no-op, inferred Node project, native run), and the container path.
 * The order is data, so "which steps ran" is assertable without executing side effects.
 */
export declare const upSteps: readonly UpStep[];
/**
 * The container run's own ordered steps, dispatched inside the Tilt availability check (`withTiltCheck`, or
 * `runCommand` for a dry run). The refusals, project writes and selection run in this order on every container up.
 */
export declare const containerSteps: readonly UpStep[];
/**
 * The concurrent readiness report inside `tilt-up`, in order. `uiReady` gates every step after the first: when the
 * Tilt UI never answers, only the state record is cleared.
 */
export declare const startupSteps: readonly UpStep[];
/**
 * Runs `steps` in order until one marks the run finished; a step that refuses calls `run.fail`, which exits.
 * The `flisk up` action is this loop over `upSteps` — nothing more.
 */
export declare function runUpSteps(run: UpRun, steps?: readonly UpStep[]): Promise<void>;
