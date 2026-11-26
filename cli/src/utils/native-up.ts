// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { DiscoveredResource } from "../types/index.js";
import { checkoutEnvVars, getCheckoutName } from "./checkout-id.js";
import { byCodeUnit } from "./compare.js";
import {
  assertCheckoutIdentityPersisted,
  checkoutDatabaseSuffix,
  checkoutScopedDatabaseUrl,
  databaseNameFromUrl,
  scopeDatabaseName,
} from "./database-name.js";
import { worktreeEnvHintMessage } from "./doctor-local-deps.js";
import { checkLiteralPorts } from "./doctor-wiring.js";
import { readEnvFileValues } from "./env-selection.js";
import { FliskError, showError } from "./errors.js";
import { formatCount } from "./formatting.js";
import { ensureGeneratedSecrets } from "./generated-secrets.js";
import {
  applyChosenNativePorts,
  perCheckoutName,
  remapNativeServicePorts,
} from "./host-port-plan.js";
import type { JsonEmitter, JsonError } from "./json-output.js";
import { isDockerRunning } from "./native-container.js";
import {
  dependencyWaves,
  findMissingPrograms,
  formatPrefix,
  isPortListening,
  isProcessAlive,
  NATIVE_DIR,
  type NativeRunPlan,
  type NativeServicePlan,
  NativeSupervisor,
  nativeRunStatePath,
  nativeServiceStates,
  planNativeRun,
  readNativeLogLines,
  readNativeRunState,
  stopNativeRun,
} from "./native-runtime.js";
import { installGuidance } from "./package-script-programs.js";
import { findPortOccupant } from "./port-occupant.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { runDatabaseUses, writeRunDatabases } from "./run-databases.js";
import { databaseResourceNames, namesSharedPlatformPostgres } from "./shared-platform-postgres.js";
import { describeToolchainFinding, findToolchainMismatches } from "./toolchain.js";
import { classifyUpFailure, withUpFailureCodes } from "./up-failure-codes.js";
import { attachedUpInCiWarning } from "./up-hints.js";

/** Lines of a failed service's own output a failed `up` carries, and the most characters of one line. */
const FAILURE_LOG_LINES = 5;
const FAILURE_LOG_LINE_CHARS = 400;
const FAILURE_LOG_SCAN_LINES = 200;

/** Consecutive identical lines folded into one, with how many times it came ("line (x3)"). */
function collapseRepeats(lines: string[]): string[] {
  const out: string[] = [];
  let count = 0;
  for (const [i, line] of lines.entries()) {
    count += 1;
    if (line !== lines[i + 1]) {
      out.push(count > 1 ? `${line} (x${count})` : line);
      count = 0;
    }
  }
  return out;
}

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
export function nativeUrlChecks(
  services: readonly Pick<NativeServicePlan, "name" | "url">[],
  statuses?: ReadonlyMap<string, number>,
): Array<{ service: string; url: string; didAnswer: boolean; status: number }> {
  return services.flatMap((service) =>
    service.url
      ? [
          {
            service: service.name,
            url: service.url,
            didAnswer: true,
            status: statuses?.get(service.name) ?? 200,
          },
        ]
      : [],
  );
}

/**
 * Each failure with the last lines its service wrote (`logs`). The reason alone ("kept exiting; see its output above")
 * points at output that a `--json` or MCP caller never saw, so the cause (a missing variable, a stack trace) travels with
 * the failure. Lines come from `.flisk/native/logs`, which the supervisor masked when it wrote them; a service that
 * wrote nothing, or was never started, keeps its failure as it was. With `sinceEpochMs`, lines from earlier runs (the logs
 * are appended to) are left out.
 */
export function withFailureLogs(
  projectRoot: string,
  failures: NativeFailure[],
  sinceEpochMs?: number,
): NativeFailure[] {
  return failures.map((failure) => {
    // A crash loop repeats one line on every restart; reading further back and folding repeats shows what came before it.
    const lines = readNativeLogLines(projectRoot, [failure.name], {
      tail: FAILURE_LOG_SCAN_LINES,
      ...(sinceEpochMs === undefined ? {} : { sinceMs: Date.now() - sinceEpochMs }),
    })
      .map((line) => line.text.trimEnd())
      .filter((text) => text.trim());
    const logs = collapseRepeats(lines)
      .slice(-FAILURE_LOG_LINES)
      .map((text) =>
        text.length > FAILURE_LOG_LINE_CHARS
          ? `${text.slice(0, FAILURE_LOG_LINE_CHARS - 1)}…`
          : text,
      );
    return logs.length > 0 ? { ...failure, logs } : failure;
  });
}

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
  inferred?: { command: string; script: string };
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
export function runVariables(
  projectRoot: string,
  envFilePath?: string,
  options: { persistCheckout?: boolean } = {},
): Record<string, string> {
  const path = envFilePath ?? join(projectRoot, ".env");
  const fromFile = existsSync(path) ? Object.fromEntries(readEnvFileValues(path)) : {};
  const fromShell = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...fromFile,
    ...fromShell,
    ...checkoutEnvVars(projectRoot, { persist: options.persistCheckout !== false }),
  };
}

/**
 * Names (never values) of variables the .env sets that the shell overrides with a different value. A restart
 * re-reads the .env but the shell of the running `flisk up` still wins, so an edit to these has no effect.
 */
export function shadowedEnvKeys(
  projectRoot: string,
  envFilePath?: string,
  shell: NodeJS.ProcessEnv = process.env,
): string[] {
  const path = envFilePath ?? join(projectRoot, ".env");
  if (!existsSync(path)) return [];
  return [...readEnvFileValues(path)]
    .filter(([key, value]) => shell[key] !== undefined && shell[key] !== value)
    .map(([key]) => key)
    .sort(byCodeUnit);
}

/**
 * Env entries that override the project .env for a local service. The .env can still hold the Docker host's
 * DATABASE_URL; a service with no database in dependsOn must read it as empty, or its /health check pings a host
 * that does not exist and never goes healthy (#4456). A service that does depend on the database keeps the value.
 */
export function localDatabaseEnv(
  dependsOn: readonly string[],
  databaseNames: readonly string[] = [],
  declaredEnv: Readonly<Record<string, string>> = {},
  projectRoot?: string,
  options: { persist?: boolean } = {},
): Record<string, string> {
  const url = declaredEnv.DATABASE_URL ?? "";
  // A dry run passes persist: false so it never writes the checkout identity record.
  const suffix = checkoutDatabaseSuffix(projectRoot, options);
  // A worktree often starts from a copied .env that still names the main checkout's database. Scope both the URL and
  // the database name to this checkout. The main checkout has no suffix and therefore sees no change (#4698).
  // A literal URL to another host or database is the service author's choice: never rewrite or blank it.
  const isGeneratedUrl = /^postgres(?:ql)?:\/\/[^@/]+@postgres:5432\/app_dev(?:[?#]|$)/.test(url);
  // Only the generated shared-Postgres form counts as checkout-managed; a custom host or database is never touched,
  // whatever its database name ends with.
  const isCheckoutUrl = Boolean(
    suffix &&
      /^postgres(?:ql)?:\/\/[^@/]+@postgres:5432\/app_dev_[0-9a-f]{8}(?:[?#]|$)/.test(url) &&
      databaseNameFromUrl(url).endsWith(suffix),
  );
  if (declaredEnv.DATABASE_URL && !isGeneratedUrl && !isCheckoutUrl) return {};
  if (!dependsOn.some((name) => namesSharedPlatformPostgres(name, databaseNames))) {
    return { DATABASE_URL: "" };
  }
  if (!suffix) return {};
  const scopedUrl = isGeneratedUrl
    ? checkoutScopedDatabaseUrl(url, projectRoot, options)
    : isCheckoutUrl
      ? url
      : "";
  const name =
    declaredEnv.DATABASE_NAME ?? (isGeneratedUrl || isCheckoutUrl ? databaseNameFromUrl(url) : "");
  if (!scopedUrl && !name) return {};
  return {
    ...(scopedUrl ? { DATABASE_URL: scopedUrl } : {}),
    ...(name ? { DATABASE_NAME: scopeDatabaseName(name, suffix) } : {}),
  };
}

/**
 * The checkout name a person gave (`FLISK_CHECKOUT_NAME` they set, or `worktree.name` / `checkout.name` in project.json).
 * Every checkout also has a name derived from its folder, which `flisk up` exports for interpolation; that one is not a
 * request to move ports, so a plain project with a busy port still fails (#4047).
 */
export function explicitCheckoutName(
  projectRoot: string,
  vars: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const { FLISK_CHECKOUT_NAME: given, ...rest } = vars;
  return perCheckoutName(
    projectRoot,
    given !== undefined && given !== getCheckoutName(projectRoot) ? vars : rest,
  );
}

/** A problem `flisk up` can detect before starting anything, in both a real run and a dry run. */
export interface UpPreflightProblem {
  code: string;
  message: string;
  suggestions?: string[];
  /** Set when the problem is one service failing to start, so machine callers get the same `failures[]` as a runtime failure. */
  failure?: { name: string; exitCode: number | null; program?: string };
}

/**
 * The static preflight shared by `flisk up` and `flisk up --dry-run`: an invalid plan (including two services on one
 * port), a binding toolchain mismatch and a command whose program is not installed. Everything here only reads, so a
 * dry run reports these problems with `ok: false` and exits 1 instead of printing a plan a real run would refuse.
 */
export function nativeUpPreflight(
  selected: readonly DiscoveredResource[],
  plan: { services: readonly NativeServicePlan[]; errors: string[] },
): UpPreflightProblem[] {
  const problems: UpPreflightProblem[] = [];
  if (plan.errors.length > 0) {
    const message = plan.errors.join("\n");
    problems.push({
      code: "INVALID_SERVICE_CONFIG",
      message: message.includes("both use port")
        ? `${message}\nFix: Give each service a different "port" in its service.json (or use flisk resource to assign free ports).`
        : message,
    });
  }

  const toolchainMismatches = findToolchainMismatches(selected).filter(
    (finding) => !finding.isHint,
  );
  if (toolchainMismatches.length > 0) {
    problems.push({
      code: "TOOLCHAIN_MISMATCH",
      message: `${toolchainMismatches.map(describeToolchainFinding).join("\n")}\nSwitch to that version with your version manager, or change "toolchain" in the service.json.`,
    });
  }

  for (const { name, program, script } of findMissingPrograms(plan.services)) {
    problems.push({
      code: "NATIVE_COMMAND_NOT_FOUND",
      // Nothing was started, so there is no exit code to report.
      failure: { name, exitCode: null, program },
      message:
        script === undefined
          ? `service "${name}" runs ${program}, which is not installed (not found on PATH). Install it, or change "command" in its service.json.`
          : `${name}: script "${script}" starts ${program}, which is not installed. ${installGuidance(program)}, or change the script in its package.json.`,
    });
  }
  return problems;
}

/**
 * The host-port half of the same preflight. A real run calls it only after an already-running stack has been reported,
 * since that stack legitimately holds its own ports; a dry run calls it before printing its plan.
 */
export async function nativeUpPortPreflight(
  services: readonly NativeServicePlan[],
): Promise<UpPreflightProblem[]> {
  const problems: UpPreflightProblem[] = [];
  for (const service of services) {
    if (service.port === undefined || !(await isPortListening(service.port))) continue;
    const occupant = findPortOccupant(service.port);
    problems.push({
      code: "PORT_IN_USE",
      failure: { name: service.name, exitCode: null },
      message: `Port ${service.port} for service "${service.name}" is already in use${occupant ? ` by ${occupant.command} (pid ${occupant.pid})` : ""}. Stop it, or change "port" in the service.json.`,
    });
  }
  return problems;
}

/** Short-lived exclusive lock that makes the "is this project starting?" decision atomic (#3727). */
const UP_LOCK_FILE = "up.lock";
const MAX_LOCK_ATTEMPTS = 8;

interface UpLock {
  /** Set when another live `flisk up` owns the project; the caller answers from the existing already-running branch. */
  busyPid?: number;
  release(): void;
}

function nativeUpLockPath(projectRoot: string): string {
  return join(projectRoot, NATIVE_DIR, UP_LOCK_FILE);
}

function readLockPid(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf-8").trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Take the lock with `wx` so two starts cannot both win. A lock whose pid is alive means a start is in progress; a lock
 * whose pid is dead (or unreadable) is stale and is removed. Keeping the lock until the supervisor has written run state
 * closes the gap where both commands saw no run state and both spawned services.
 */
function acquireNativeUpLock(projectRoot: string, isAlive: (pid: number) => boolean): UpLock {
  const dir = join(projectRoot, NATIVE_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  const path = nativeUpLockPath(projectRoot);
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = readLockPid(path);
      if (pid !== undefined && isAlive(pid)) return { busyPid: pid, release: () => {} };
      rmSync(path, { force: true });
      continue;
    }
    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
    return { release: () => rmSync(path, { force: true }) };
  }
  // Only reachable if other processes keep replacing stale locks; never start unguarded.
  throw new FliskError(`Could not acquire the native up lock at ${path}`, [
    "Check that no other `flisk up` is running in this project",
    `If none is, remove ${path} and rerun \`flisk up\``,
  ]);
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
  readonly failProblems: (
    problems: readonly UpPreflightProblem[],
    extra?: Record<string, unknown>,
  ) => never;
  /** `failProblems` for a single coded problem. */
  readonly fail: (
    code: string,
    message: string,
    data?: Record<string, unknown>,
    suggestions?: string[],
  ) => never;
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
export function createNativeUpRun(input: NativeUpInput): NativeUpRun {
  const exit = input.exit ?? ((code: number) => process.exit(code));
  const run: NativeUpRun = {
    input,
    quiet: Boolean(input.quiet),
    exit,
    finished: false,
    vars: {},
    plan: { services: [], errors: [], missingVars: [], missingEnvRefs: [] },
    databaseNames: [],
    serviceNames: [],
    containers: [],
    startOrder: [],
    chosenPorts: new Map(),
    declaredPorts: new Map(),
    failProblems(problems, extra = {}) {
      run.finished = true;
      run.upLock?.release();
      run.upLock = undefined;
      const classified = withUpFailureCodes(
        problems.flatMap(({ failure, message }) =>
          failure ? [{ ...failure, reason: message }] : [],
        ),
      );
      let classifiedIndex = 0;
      const errors: JsonError[] = problems.map(({ code, message, suggestions, failure }) => {
        const own = suggestions && suggestions.length > 0 ? suggestions : undefined;
        const fromFailure = failure ? classified[classifiedIndex++]?.suggestions : undefined;
        const chosen = own ?? (fromFailure && fromFailure.length > 0 ? fromFailure : undefined);
        return { code, message, ...(chosen ? { suggestions: chosen } : {}) };
      });
      input.emit?.(
        {
          ok: false,
          runtime: "native",
          ...(classified.length > 0 ? { failures: classified } : {}),
          ...extra,
        },
        errors,
      );
      showError(problems.map((problem) => problem.message).join("\n"));
      return run.exit(1);
    },
    fail(code, message, data = {}, suggestions) {
      return run.failProblems([{ code, message, suggestions }], data);
    },
  };
  return run;
}

/** One phase of a native `flisk up`: `guard` decides whether it runs for this input; `run` does the phase. */
export interface NativeUpStep {
  readonly name: string;
  readonly guard?: (run: NativeUpRun) => boolean;
  readonly run: (run: NativeUpRun) => void | Promise<void>;
}

const isRealRun = (run: NativeUpRun): boolean => !run.input.dryRun;
const isDryRun = (run: NativeUpRun): boolean => Boolean(run.input.dryRun);

/** Write the names a service declares in `secrets.generate` to the env file once, before anything starts (never printed). */
export function nativeUpSecrets(run: NativeUpRun): void {
  const { projectRoot, selected } = run.input;
  const generatedNames = ensureGeneratedSecrets(projectRoot, selected, {
    envFilePath: run.input.envFilePath,
    dryRun: run.input.dryRun,
  });
  if (generatedNames.length > 0 && !run.quiet && !run.input.dryRun) {
    console.log(
      chalk.gray(
        `Generated ${generatedNames.join(", ")} into the env file (once; existing values unchanged)`,
      ),
    );
  }
}

/**
 * The run's env: the project .env (or `--env-file`), overridden by the shell. A worktree without its gitignored
 * .env is a common source of confusing missing-key errors (#4048), so it points at another worktree's file and
 * prints the copy command, but never copies it: the values may be worktree-specific.
 */
export function nativeUpEnv(run: NativeUpRun): void {
  const { projectRoot } = run.input;
  run.vars = runVariables(projectRoot, run.input.envFilePath, {
    persistCheckout: !run.input.dryRun,
  });
  if (!run.input.dryRun) assertCheckoutIdentityPersisted(projectRoot);
  if (!run.input.envFilePath && !run.quiet && !existsSync(join(projectRoot, ".env"))) {
    const hint = worktreeEnvHintMessage(projectRoot);
    if (hint) console.warn(chalk.yellow(`⚠ ${hint}`));
  }
}

/**
 * The start plans, the shared-database names the run blanks `DATABASE_URL` for, and the service/container
 * views later steps print and check. A `${VAR}` that expanded to nothing is warned about once here.
 */
export function nativeUpPlan(run: NativeUpRun): void {
  const { projectRoot, selected } = run.input;
  run.plan = planNativeRun(
    selected,
    run.vars,
    projectRoot,
    readProjectNameOrUndefined(projectRoot),
    { persistCheckout: !run.input.dryRun },
  );
  run.databaseNames = databaseResourceNames(selected);
  for (const service of run.plan.services) {
    if (!service.container) {
      Object.assign(
        service.env,
        localDatabaseEnv(service.dependsOn, run.databaseNames, service.env, projectRoot, {
          persist: !run.input.dryRun,
        }),
      );
    }
  }
  run.containers = run.plan.services.filter((service) => service.container);
  run.serviceNames = run.plan.services.map((service) => service.name);
  if (run.plan.missingVars.length > 0 && !run.quiet) {
    console.warn(
      chalk.yellow(
        `Unset variables expanded to an empty value: ${run.plan.missingVars.join(", ")}. Set them in .env or the shell.`,
      ),
    );
  }
}

/**
 * One preflight for both modes: a dry run must refuse the same project a real start would refuse. It only reads,
 * so the problems are collected before the dry-run plan is printed, and no generated file is written.
 */
export function nativeUpStaticPreflight(run: NativeUpRun): void {
  const problems = nativeUpPreflight(run.input.selected, run.plan);
  if (problems.length > 0) {
    run.failProblems(problems, run.input.dryRun ? { dryRun: true } : {});
  }
}

/**
 * Check for a live run before printing the start banner: a second `flisk up` starts nothing, so it must not
 * claim to (#4642). Dry runs never enter this step, so they still print their plan.
 */
function reportAlreadyRunning(run: NativeUpRun, pid: number): void {
  const message = `This project is already running as local processes (flisk up, pid ${pid}).`;
  run.input.emit?.({ ok: true, alreadyRunning: true, runtime: "native", pid });
  if (!run.quiet) {
    console.log(chalk.green(message));
    console.log(chalk.gray("Stop it with flisk down, or pass --force to restart it."));
  }
  run.finished = true;
}

export async function nativeUpExistingRun(run: NativeUpRun): Promise<void> {
  const { projectRoot } = run.input;
  // The lock makes the check exclusive, so two starts racing on empty run state cannot both begin (#3727).
  const lock = acquireNativeUpLock(projectRoot, isProcessAlive);
  if (lock.busyPid !== undefined) {
    reportAlreadyRunning(run, lock.busyPid);
    return;
  }
  run.upLock = lock;
  const running = readNativeRunState(projectRoot);
  if (running && running.pid !== process.pid && isProcessAlive(running.pid)) {
    if (!run.input.force) {
      reportAlreadyRunning(run, running.pid);
      lock.release();
      run.upLock = undefined;
      return;
    }
  }
  if (running) {
    // A previous run that was replaced (--force) or killed without cleaning up: stop whatever it left behind.
    await stopNativeRun(projectRoot);
  }
}

/** The start banner and the service list it prints, plus the dependency waves a dry run reports. */
export function nativeUpBanner(run: NativeUpRun): void {
  const { selected, stackName, only, dependencies, dryRun } = run.input;
  run.startOrder = dependencyWaves(run.plan.services);
  const description = only
    ? `${formatCount(only.length, "requested service")}${dependencies.length > 0 ? ` plus ${dependencies.join(", ")}` : ""}`
    : stackName
      ? `stack "${stackName}"`
      : formatCount(run.serviceNames.length, "service");
  if (!run.quiet) {
    console.log(
      chalk.blue(
        `${dryRun ? "Would start" : "Starting"} ${description} as local processes${run.containers.length > 0 ? `, ${run.containers.map((service) => service.name).join(", ")} with docker run (no Tilt)` : " (no Docker, no Tilt)"}...`,
      ),
    );
    for (const service of run.plan.services) {
      const after = service.dependsOn.length > 0 ? ` (after ${service.dependsOn.join(", ")})` : "";
      const what = service.container
        ? `container ${String(selected.find((resource) => resource.name === service.name)?.config?.image)}`
        : service.command;
      console.log(chalk.gray(`  - ${service.name}: ${what}${after}`));
    }
  }
}

/** A dry run's last step: refuse a taken port the same way a real run would, then emit the plan and stop. */
export async function nativeUpDryRun(run: NativeUpRun): Promise<void> {
  const { input } = run;
  const literalPortsCheck = checkLiteralPorts(input.projectRoot, input.selected);
  const literalWarnings = literalPortsCheck.didPass ? [] : [literalPortsCheck.message];
  if (!literalPortsCheck.didPass && !run.quiet) {
    console.warn(chalk.yellow(`⚠️  Literal ports: ${literalPortsCheck.message}`));
  }
  const portProblems = await nativeUpPortPreflight(run.plan.services);
  if (portProblems.length > 0) {
    run.failProblems(portProblems, { dryRun: true });
  }
  input.emit?.({
    ok: true,
    dryRun: true,
    runtime: "native",
    ...(input.inferred ? { inferred: input.inferred } : {}),
    stack: input.stackName ?? null,
    services: run.serviceNames,
    ...(input.only ? { requested: input.only, declaredDependencies: input.dependencies } : {}),
    startOrder: run.startOrder,
    ...(run.containers.length > 0
      ? { containers: run.containers.map((service) => service.name) }
      : {}),
    ...(literalWarnings.length > 0 ? { warnings: literalWarnings } : {}),
  });
  if (!run.quiet) console.log(chalk.yellow("Dry run: not starting services"));
  run.finished = true;
}

/** The checks only a real start runs after it passed the dry-run checks: Docker when a container needs it, then the ports. */
export async function nativeUpRuntimePreflight(run: NativeUpRun): Promise<void> {
  if (run.containers.length > 0 && !isDockerRunning()) {
    const message = `${run.containers.map((service) => service.name).join(", ")} run from an image, which needs Docker, and Docker is not running. Start Docker Desktop, OrbStack, Colima or Kiri, then run flisk up again.`;
    const failure = classifyUpFailure({
      name: run.containers[0]?.name ?? "docker",
      reason: message,
    });
    run.fail("DOCKER_NOT_RUNNING", message, { failures: [failure] }, failure.suggestions);
  }
  if (run.finished) return;

  // A checkout under its own name gets a free port at run time when the one in service.json is taken. The plan is the
  // only thing that changes: service.json is never written back, and a single checkout without a name still fails below.
  run.declaredPorts = new Map(
    run.plan.services.flatMap((service) =>
      service.port === undefined ? [] : [[service.name, service.port] as const],
    ),
  );
  const checkoutName =
    run.input.checkoutName ?? explicitCheckoutName(run.input.projectRoot, run.vars);
  if (checkoutName) {
    const remap = await remapNativeServicePorts(run.plan.services, checkoutName, {
      isAvailable:
        run.input.isPortAvailable ?? (async (port: number) => !(await isPortListening(port))),
    });
    for (const [name, port] of remap.ports) run.chosenPorts.set(name, port);
    if (remap.ports.size > 0 && !run.quiet) {
      console.log(
        chalk.yellow(
          `Checkout "${checkoutName}" moved ${[...remap.ports].map(([name, port]) => `${name}: ${port}`).join(", ")} to free ports (service.json unchanged)`,
        ),
      );
    }
  }

  const portProblems = await nativeUpPortPreflight(run.plan.services);
  if (portProblems.length > 0) run.failProblems(portProblems);
}

/** What a restart (`flisk restart`, the MCP resource_restart) replans from: the env as it is now. */
function nativeUpReload(run: NativeUpRun): {
  plans: readonly NativeServicePlan[];
  baseEnv: Readonly<Record<string, string | undefined>>;
} {
  const { projectRoot, selected } = run.input;
  const fresh = runVariables(projectRoot, run.input.envFilePath);
  const shadowed = shadowedEnvKeys(projectRoot, run.input.envFilePath);
  if (shadowed.length > 0 && !run.quiet) {
    console.log(
      chalk.yellow(
        `[flisk] ${shadowed.join(", ")} set in .env but overridden by the shell that started \`flisk up\`; a restart keeps the shell value. Unset it and run \`flisk down\` then \`flisk up\`.`,
      ),
    );
  }
  const replanned = planNativeRun(
    selected,
    fresh,
    projectRoot,
    readProjectNameOrUndefined(projectRoot),
  );
  if (replanned.errors.length > 0)
    throw new FliskError(replanned.errors.join("\n"), [
      "Fix the problems above, then rerun `flisk up`",
      "Run `flisk doctor` to check the project",
    ]);
  for (const service of replanned.services) {
    if (!service.container) {
      Object.assign(
        service.env,
        localDatabaseEnv(service.dependsOn, run.databaseNames, service.env, projectRoot, {
          persist: !run.input.dryRun,
        }),
      );
    }
  }
  if (run.chosenPorts.size > 0) {
    applyChosenNativePorts(replanned.services, run.chosenPorts, run.declaredPorts);
  }
  return { plans: replanned.services, baseEnv: fresh };
}

/**
 * Records the shared-Postgres databases this run uses, so `flisk doctor` can compare the names running checkouts
 * actually claim rather than the names a fresh `flisk up` would derive (#5132).
 */
export function nativeUpRunRecord(run: NativeUpRun): void {
  writeRunDatabases(
    run.input.projectRoot,
    runDatabaseUses(run.input.projectRoot, run.input.selected),
  );
}

/** The supervisor for the run: the service plans, the prefixed live output (unless quiet), and the replan a restart reads. */
export function nativeUpSupervisor(run: NativeUpRun): void {
  const { projectRoot } = run.input;
  const width = Math.max(...run.serviceNames.map((name) => name.length));
  const prefix = (name: string) => formatPrefix(name, run.serviceNames.indexOf(name), width);
  run.supervisor = new NativeSupervisor(
    projectRoot,
    run.plan.services,
    {
      onLine: run.quiet ? undefined : (name, line) => console.log(`${prefix(name)}${line}`),
      onNote: run.quiet
        ? undefined
        : (name, message) => console.log(`${prefix(name)}${chalk.gray(`[flisk] ${message}`)}`),
    },
    {
      readyTimeoutMs: run.input.readyTimeoutMs,
      baseEnv: run.vars,
      extraEnvPaths: run.input.envFilePath ? [run.input.envFilePath] : [],
      // A restart (`flisk restart`, the MCP resource_restart) re-reads the .env, so a repaired value takes effect.
      reload: () => nativeUpReload(run),
    },
  );
}

/**
 * Stop the run on a signal once (the supervisor stops, then exit 0), and remove this run's run.json when the
 * process exits: if every service exits for good, nothing keeps `flisk up` alive and no run.json may be left.
 */
export function nativeUpGuards(run: NativeUpRun): void {
  const { projectRoot } = run.input;
  const supervisor = run.supervisor;
  if (supervisor === undefined) return;
  const stopAndExit = (code: number) => {
    run.stopping ??= (async () => {
      run.upLock?.release();
      run.upLock = undefined;
      if (!run.quiet) console.log(chalk.gray("\nStopping local processes..."));
      await supervisor.stop();
      run.exit(code);
    })();
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => stopAndExit(0));
  }
  process.once("exit", () => {
    run.upLock?.release();
    if (readNativeRunState(projectRoot)?.pid === process.pid) {
      rmSync(nativeRunStatePath(projectRoot), { force: true });
    }
  });
}

/**
 * Start the supervisor, then report: a failed start carries each failed service's last log lines and exits 1;
 * an up run emits its URLs and prints the stop hint, then stays parked on the services.
 */
export async function nativeUpStart(run: NativeUpRun): Promise<void> {
  const { projectRoot, emit } = run.input;
  const supervisor = run.supervisor;
  if (supervisor === undefined) return;

  // The service logs are appended to across runs: only lines written since this start can explain this failure.
  const startedAt = Date.now() - 1000;
  let started: Awaited<ReturnType<NativeSupervisor["start"]>>;
  try {
    started = await supervisor.start();
  } finally {
    // The supervisor has written run state by now; the run state, not the lock, owns the rest of the run.
    run.upLock?.release();
    run.upLock = undefined;
  }
  if (run.stopping) return;
  if (started.length > 0) {
    // The supervisor is stopped right after this report, so advice to restart one service cannot apply.
    const logDir = join(NATIVE_DIR, "logs");
    const failures = withUpFailureCodes(withFailureLogs(projectRoot, started, startedAt), {
      stackStopped: true,
    }).map((failure) => {
      // Quiet mode (--json, MCP) prints no service output, so each failure names the log that holds it (#3848).
      return { ...failure, log: `${logDir}/${failure.name}.log` };
    });
    const message = [
      "Local processes did not start:",
      // Quiet (--json, MCP): nothing was printed above, so each failure carries its service's last lines.
      ...failures.flatMap((failure) => [
        `  ✗ ${failure.name}: ${failure.reason}`,
        ...(run.quiet ? (failure.logs ?? []).map((line) => `      ${line}`) : []),
      ]),
      `Output of every service: ${run.serviceNames
        .map((name) => `${logDir}/${name}.log`)
        .join(", ")}`,
    ].join("\n");
    const suggestions = [...new Set(failures.flatMap((failure) => failure.suggestions))];
    emit?.({ ok: false, runtime: "native", failures }, [
      { code: "UP_RESOURCE_FAILED", message, suggestions },
    ]);
    showError(message);
    await supervisor.stop();
    run.exit(1);
    return;
  }

  const optionalFailures =
    "optionalFailures" in supervisor && typeof supervisor.optionalFailures === "function"
      ? supervisor.optionalFailures()
      : [];
  const optionalFailedNames = new Set(optionalFailures.map((failure) => failure.name));
  const optionalWarnings = optionalFailures.map(
    (failure) => `${failure.name} (optional health check): ${failure.reason}`,
  );
  emit?.({
    ok: true,
    runtime: "native",
    ...(run.input.inferred ? { inferred: true } : {}),
    stack: run.input.stackName ?? null,
    services: run.serviceNames,
    ...(run.input.only ? { requested: run.input.only, dependencies: run.input.dependencies } : {}),
    ...(run.chosenPorts.size > 0
      ? {
          remappedPorts: [...run.chosenPorts].map(([service, port]) => ({ service, port })),
        }
      : {}),
    ...(optionalFailures.length > 0 ? { optionalFailures, warnings: optionalWarnings } : {}),
    urls: nativeUrlChecks(
      run.plan.services.filter((service) => !optionalFailedNames.has(service.name)),
      "readyStatuses" in supervisor && typeof supervisor.readyStatuses === "function"
        ? supervisor.readyStatuses()
        : undefined,
    ),
  });
  if (!run.quiet) {
    const lines = [
      run.containers.length > 0
        ? `Flisk is up (local processes, ${formatCount(run.containers.length, "container")} with docker run).`
        : "Flisk is up (local processes, no Docker).",
      "Services:",
    ];
    // Read after start(): a one-shot that already finished records ready with no live process.
    const states = nativeServiceStates(
      projectRoot,
      run.plan.services.map((service) => service.name),
    );
    for (const service of run.plan.services) {
      const health = service.healthUrl ? ` (health: ${service.healthUrl})` : "";
      // A one-shot that already finished prints "(finished)" instead of a URL nothing serves (#5120).
      const finished = states[service.name]?.reason === "finished";
      if (finished) {
        lines.push(`  ✓ ${service.name} (finished)`);
      } else if (optionalFailedNames.has(service.name)) {
        lines.push(
          `  ⚠ ${service.name}${service.url ? ` → ${service.url}` : ""}${health} (optional health check failed)`,
        );
      } else {
        lines.push(`  ✓ ${service.name}${service.url ? ` → ${service.url}` : ""}${health}`);
      }
    }
    lines.push("Stop: Ctrl+C here, or flisk down from another terminal");
    lines.push(`Logs: flisk logs --service <name>, or ${join(NATIVE_DIR, "logs")}/<service>.log`);
    for (const line of lines) console.log(chalk.blue(line));
    for (const warning of optionalWarnings) console.log(chalk.yellow(`Warning: ${warning}`));
    const ciWarning = attachedUpInCiWarning(process.env);
    if (ciWarning) console.log(chalk.yellow(ciWarning));
  }
  // The services keep the process alive; `flisk up` ends when it is stopped.
  await new Promise<void>(() => {});
}

/**
 * The native `flisk up` flow in order. `existing-run` is skipped for a dry run (it must still print its plan);
 * `dry-run` is the last step a dry run reaches, and it marks the run finished so the real-start steps never run.
 */
export const nativeUpSteps: readonly NativeUpStep[] = [
  { name: "secrets", run: nativeUpSecrets },
  { name: "env", run: nativeUpEnv },
  { name: "plan", run: nativeUpPlan },
  { name: "static-preflight", run: nativeUpStaticPreflight },
  { name: "existing-run", guard: isRealRun, run: nativeUpExistingRun },
  { name: "banner", run: nativeUpBanner },
  { name: "dry-run", guard: isDryRun, run: nativeUpDryRun },
  { name: "runtime-preflight", guard: isRealRun, run: nativeUpRuntimePreflight },
  { name: "run-databases", guard: isRealRun, run: nativeUpRunRecord },
  { name: "supervisor", guard: isRealRun, run: nativeUpSupervisor },
  { name: "guards", guard: isRealRun, run: nativeUpGuards },
  { name: "start", guard: isRealRun, run: nativeUpStart },
];

/**
 * `flisk up` for a selection where every service declares `command`: no Docker, no Compose, no Tilt and no generated files.
 * Runs `nativeUpSteps` in order and resolves only when the run ends (Ctrl+C, `flisk down`, or a failed start, which exits 1).
 */
export async function runNativeUp(input: NativeUpInput): Promise<void> {
  const run = createNativeUpRun(input);
  for (const step of nativeUpSteps) {
    if (run.finished) return;
    if (step.guard !== undefined && !step.guard(run)) continue;
    await step.run(run);
  }
}
