// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * Starts FliskOS: turns the launch surface in `surface.ts` into a spawned process, forwards terminal signals to it
 * and, with `--json`, reads the URL it listens on out of its output. `spawn` comes in through `OsDeps`, so a test can
 * run the whole launch without a process.
 */
import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { FliskError, runCommand } from "../../utils/errors.js";
import { JsonCommandError, runJsonCommand } from "../../utils/json-command.js";
import {
  defaultHost,
  FLISKOS_APP,
  FLISKOS_COMMAND,
  FLISKOS_PACKAGE,
  FLISKOS_REPOSITORY,
  type FliskOsHost,
  type FliskOsLocation,
  fliskOsArgs,
  locateFliskOs,
  notInstalledError,
  type OsOptions,
  type OsReport,
  parsePort,
  resolveOsProject,
} from "./surface.js";

/** How long `--json` waits for FliskOS to say where it listens before it gives up. */
export const READY_TIMEOUT_MS = 30_000;

/** The JSON code for an app launch whose options require the `fliskos` command. */
export const FLISKOS_COMMAND_REQUIRED_CODE = "FLISKOS_COMMAND_REQUIRED";

/** The line `fliskos` prints once its server listens. It must be complete: a chunk can end inside the URL. */
const RUNNING_LINE = /FliskOS is running at (\S+)\r?\n/;

/** The longest stretch of FliskOS output kept while `--json` looks for the line above. */
const MAX_SCANNED_OUTPUT = 4096;

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

/** How a child ended: with an exit code, or because it could not start at all. */
interface ChildExit {
  code: number;
  error?: Error;
}

function waitForExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolveExit) => {
    child.once("error", (error) => resolveExit({ code: 127, error }));
    child.once("close", (code) => resolveExit({ code: code ?? 1 }));
  });
}

function startError(path: string, error: Error): FliskError {
  return new FliskError(`Could not start ${path}: ${error.message}`, [
    `Check that it is executable: ls -l ${path}`,
    `Reinstall it: npm install --global ${FLISKOS_PACKAGE}`,
  ]);
}

/**
 * The app opens a window and has no server to report, so a request for either must fail before `open` is called.
 * This is a coded `FliskError` so `--json` gets the same code as the human error.
 */
function commandRequiredError(options: OsOptions): JsonCommandError {
  const flags = [options.open === false ? "--no-open" : "", options.json ? "--json" : ""].filter(
    Boolean,
  );
  const reasons = [
    options.open === false
      ? `--no-open needs the \`${FLISKOS_COMMAND}\` command; ${FLISKOS_APP}.app always opens a window, so no window was opened`
      : "",
    options.json
      ? `--json needs the \`${FLISKOS_COMMAND}\` command; ${FLISKOS_APP}.app has no server URL to report, so no window was opened`
      : "",
  ].filter(Boolean);
  return new JsonCommandError(FLISKOS_COMMAND_REQUIRED_CODE, `${reasons.join("; ")}.`, [
    `Install it: npm install --global ${FLISKOS_PACKAGE}`,
    `Or run \`flisk os\` without ${flags.join(" or ")} to open the app.`,
  ]);
}

/**
 * Keeps `flisk os` alive until FliskOS is done. A terminal sends Ctrl+C to FliskOS itself, so there this process only
 * has to outlive it; a signal sent to this process alone is passed on, or FliskOS would keep running and hold its
 * port. Returns the function that puts the signals back.
 */
function forwardSignals(child: ChildProcess): () => void {
  const pass = (signal: NodeJS.Signals) => () => {
    child.kill(signal);
  };
  const handlers: Array<[NodeJS.Signals, () => void]> = [
    ["SIGTERM", pass("SIGTERM")],
    ["SIGHUP", pass("SIGHUP")],
    ["SIGINT", process.stdin.isTTY ? () => {} : pass("SIGINT")],
  ];
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

/**
 * Resolves with the URL `fliskos` prints once it listens, copying everything it prints to stderr so stdout stays free
 * for the envelope. Rejects when it exits first or says nothing within the timeout.
 */
function waitForUrl(
  child: ChildProcess,
  finished: Promise<number>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    let isSettled = false;
    const settle = (action: () => void): void => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      settle(() => {
        child.kill();
        reject(
          new JsonCommandError(
            "FLISKOS_FAILED",
            `FliskOS did not say where it listens within ${Math.round(timeoutMs / 1000)} seconds`,
            [`Run \`${FLISKOS_COMMAND}\` on its own to see what it prints`],
          ),
        );
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      if (isSettled) return;
      output = (output + chunk.toString()).slice(-MAX_SCANNED_OUTPUT);
      const match = RUNNING_LINE.exec(output);
      if (match?.[1]) settle(() => resolveUrl(match[1] as string));
    });
    finished.then(
      (code) =>
        settle(() =>
          reject(
            new JsonCommandError(
              "FLISKOS_FAILED",
              `${FLISKOS_COMMAND} exited with code ${code} before it started listening`,
              [
                `Run \`${FLISKOS_COMMAND}\` on its own to see why`,
                "If the port is taken, pass another one with --port",
              ],
              code || 1,
            ),
          ),
        ),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/** Preference-only options the app cannot take: it finds projects itself and chooses its own port. */
function ignoredByApp(options: OsOptions, hasExplicitProject: boolean): string[] {
  return [
    hasExplicitProject ? "--project" : "",
    options.port !== undefined ? "--port" : "",
    (options.scanRoot ?? []).length > 0 ? "--scan-root" : "",
  ].filter(Boolean);
}

async function openApp(
  location: FliskOsLocation,
  options: OsOptions,
  hasExplicitProject: boolean,
  deps: OsDeps,
): Promise<OsLaunch> {
  if (options.open === false || options.json) throw commandRequiredError(options);
  const args = ["-a", FLISKOS_APP];
  const ignored = ignoredByApp(options, hasExplicitProject);
  console.log(chalk.gray(`Opening ${FLISKOS_APP}.app`));
  if (ignored.length > 0) {
    console.log(
      chalk.gray(
        `${FLISKOS_APP}.app does not take ${ignored.join(", ")}; install the \`${FLISKOS_COMMAND}\` command to use ${ignored.length === 1 ? "it" : "them"}.`,
      ),
    );
  }
  const child = deps.spawn(deps.host.findCommand("open") ?? "open", args, {
    cwd: deps.cwd,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const exit = await waitForExit(child);
  if (exit.error || exit.code !== 0) {
    throw new FliskError(
      exit.error
        ? `Could not run open: ${exit.error.message}`
        : `open could not start ${FLISKOS_APP}.app (exit code ${exit.code})`,
      [
        `Check that ${location.path} is a complete app: reinstall it with npm run install:mac in ${FLISKOS_REPOSITORY}`,
        `Or install the command instead: npm install --global ${FLISKOS_PACKAGE}`,
      ],
    );
  }
  console.log(chalk.green(`Opened ${FLISKOS_APP}.app`));
  return {
    report: { via: "app", path: location.path, args, project: null, url: null, ignored },
    finished: Promise.resolve(0),
  };
}

/**
 * Finds FliskOS and starts it. The command runs in the foreground with the caller's terminal, and `finished` resolves
 * with its exit code. With `--json` the command's output is piped so the URL can be read from it: this resolves once
 * FliskOS listens (so the envelope can go out), and `finished` still resolves when it stops. The app opens and returns.
 */
export async function launchFliskOs(
  options: OsOptions,
  overrides: Partial<OsDeps> = {},
): Promise<OsLaunch> {
  const deps: OsDeps = {
    host: defaultHost(),
    spawn,
    cwd: process.cwd(),
    readyTimeoutMs: READY_TIMEOUT_MS,
    ...overrides,
  };
  const port = options.port === undefined ? undefined : parsePort(options.port);
  const project = resolveOsProject(options.project, deps.cwd);
  const location = locateFliskOs(deps.host);
  if (!location) throw notInstalledError(deps.host.platform);

  if (location.via === "app") return openApp(location, options, Boolean(options.project), deps);

  const args = fliskOsArgs({
    project,
    port,
    open: options.open,
    scanRoots: (options.scanRoot ?? []).map((root) => resolve(deps.cwd, root)),
  });
  const report: OsReport = {
    via: "command",
    path: location.path,
    args,
    project,
    url: null,
    ignored: [],
  };
  console.log(chalk.gray(`Starting FliskOS: ${[FLISKOS_COMMAND, ...args].join(" ")}`));
  const child = deps.spawn(location.path, args, {
    cwd: deps.cwd,
    stdio: options.json ? ["inherit", "pipe", "inherit"] : "inherit",
  });
  const restoreSignals = forwardSignals(child);
  const finished = waitForExit(child).then((exit) => {
    restoreSignals();
    if (exit.error) throw startError(location.path, exit.error);
    return exit.code;
  });
  // A start failure is reported by whoever awaits `finished`; this keeps it from being unhandled in the meantime.
  finished.catch(() => {});
  if (!options.json) return { report, finished };
  const url = await waitForUrl(child, finished, deps.readyTimeoutMs);
  return { report: { ...report, url }, finished };
}

/**
 * Runs `flisk os`: starts FliskOS and waits for it, setting the exit code to its own. With `--json` one envelope goes
 * to stdout as soon as FliskOS is up, and the command keeps running until FliskOS stops.
 */
export async function runOs(options: OsOptions, overrides: Partial<OsDeps> = {}): Promise<void> {
  if (options.json) {
    const state: { finished?: Promise<number> } = {};
    await runJsonCommand("FLISKOS_FAILED", "flisk os", async () => {
      const launch = await launchFliskOs(options, overrides);
      state.finished = launch.finished;
      return { data: launch.report };
    });
    if (state.finished) process.exitCode = await state.finished;
    return;
  }
  await runCommand(async () => {
    const launch = await launchFliskOs(options, overrides);
    process.exitCode = await launch.finished;
  });
}
