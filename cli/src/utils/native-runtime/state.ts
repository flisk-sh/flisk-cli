// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { ServiceRuntimeState } from "../../types/index.js";
import { nativeRunIds, readNativeLogEntries, readNativeRunLog } from "../native-log.js";
import { bootTimeMs, processStartTime } from "../process-identity.js";
import { isProcessAlive } from "./ready.js";

/**
 * Where a native run keeps its state: `.flisk/native/run.json` records the supervisor and service process ids,
 * `.flisk/native/logs/<service>.log` their output, and `.flisk/native/control` the restart-request files. This
 * module reads and writes that state and answers the `flisk status`/`flisk logs` queries against it.
 */

/** The directory, under the project's .flisk/, that holds the run state and log files. */
export const NATIVE_DIR = join(".flisk", "native");
const RUN_FILE = "run.json";

/** What `.flisk/native/run.json` holds while a native run is up. */
export interface NativeRunState {
  /** The `flisk up` process supervising the services. */
  pid: number;
  /** When that process started (see process-identity.ts), so a later stop can tell it from a process given the same pid. */
  pidStartTime?: string;
  startedAt: string;
  /** `job`: a one-shot job (a migrator, or `"restart": "no"` with no port); once it exits 0 it stays `ready` with no process. */
  services: Record<
    string,
    {
      pid?: number;
      /** When the service process started; a stop signals `pid` only while it still has this start time. */
      startTime?: string;
      port?: number;
      url?: string;
      ready?: boolean;
      job?: boolean;
      /** A container started with `docker run` in a mixed run. */
      container?: string;
      /** The dependencies a service exited without is waiting for before it starts again. */
      waitingFor?: string[];
      /** Why a ready process failed its periodic re-probe enough times to be reported unhealthy (#4692). */
      unhealthy?: string;
      /** The supervisor stopped restarting it (it kept crashing, or a job exited non-zero); only a restart or a new `up` revives it. */
      failed?: boolean;
      /** Last exit code of the service's process, null when a signal ended it; absent while it has not exited. */
      lastExitCode?: number | null;
    }
  >;
}

export function nativeRunStatePath(projectRoot: string): string {
  return join(projectRoot, NATIVE_DIR, RUN_FILE);
}

export function nativeLogPath(projectRoot: string, service: string): string {
  return join(projectRoot, NATIVE_DIR, "logs", `${service}.log`);
}

/** Where restart requests and their answers are exchanged between `flisk restart` and the supervising `flisk up`. */
export function nativeControlDir(projectRoot: string): string {
  return join(projectRoot, NATIVE_DIR, "control");
}

export function readNativeRunState(projectRoot: string): NativeRunState | null {
  try {
    const state = JSON.parse(readFileSync(nativeRunStatePath(projectRoot), "utf-8"));
    return state && typeof state.pid === "number" && state.services ? state : null;
  } catch {
    return null;
  }
}

/**
 * The real ports of a native run, as recorded by the supervisor. A checkout running under its own name can hold a
 * different port from the one in service.json; status must report the port the service actually listens on (#4047).
 */
export function nativeRuntimePorts(state: NativeRunState | null): Map<string, number> {
  const ports = new Map<string, number>();
  if (!state) return ports;
  for (const [name, service] of Object.entries(state.services)) {
    if (typeof service.port === "number") ports.set(name, service.port);
  }
  return ports;
}

/** The URLs a native run really serves, in service name order as recorded in run.json. */
export function nativeRuntimeUrls(state: NativeRunState | null): string[] {
  if (!state) return [];
  return Object.values(state.services).flatMap((service) =>
    typeof service.url === "string" ? [service.url] : [],
  );
}

/**
 * The names a recorded native run still knows: every service in the run state plus any that wrote a
 * `.flisk/native/logs/<name>.log` file. A service.json discovery skipped hides its service from the
 * manifest list but not from these records, so a partial manifest list can still name it.
 */
export function recordedNativeServiceNames(projectRoot: string): string[] {
  const names = new Set(Object.keys(readNativeRunState(projectRoot)?.services ?? {}));
  try {
    for (const file of readdirSync(join(projectRoot, NATIVE_DIR, "logs"))) {
      if (file.endsWith(".log")) names.add(file.slice(0, -".log".length));
    }
  } catch {
    // A project that never ran natively has no log directory.
  }
  return [...names];
}

/** True only when the supervisor pid still belongs to the process recorded for this native run. */
export async function isNativeRunSupervisorAlive(state: NativeRunState | null): Promise<boolean> {
  if (!state || state.pidStartTime === undefined || !isProcessAlive(state.pid)) return false;
  const startedAt = Date.parse(state.startedAt);
  if (Number.isFinite(startedAt) && startedAt < bootTimeMs()) return false;
  const currentStartTime = await processStartTime(state.pid);
  return currentStartTime !== undefined && currentStartTime === state.pidStartTime;
}

/** The services map of a run.json: the supervisor's live records in the recorded shape. */
export function runServicesRecord(
  services: ReadonlyMap<
    string,
    {
      child?: { pid?: number };
      startTime?: string;
      plan: { port?: number; url?: string; job?: boolean; container?: string };
      isReady: boolean;
      gaveUp: boolean;
      waitingFor?: string[];
      unhealthyReason?: string;
      lastExitCode?: number | null;
    }
  >,
): NativeRunState["services"] {
  const record: NativeRunState["services"] = {};
  for (const [name, service] of services) {
    record[name] = {
      pid: service.child?.pid,
      ...(service.child?.pid !== undefined && service.startTime
        ? { startTime: service.startTime }
        : {}),
      port: service.plan.port,
      url: service.plan.url,
      ready: service.isReady,
      ...(service.plan.job ? { job: true } : {}),
      ...(service.plan.container ? { container: service.plan.container } : {}),
      ...(service.waitingFor ? { waitingFor: service.waitingFor } : {}),
      ...(service.unhealthyReason ? { unhealthy: service.unhealthyReason } : {}),
      ...(service.gaveUp ? { failed: true } : {}),
      ...(service.lastExitCode !== undefined ? { lastExitCode: service.lastExitCode } : {}),
    };
  }
  return record;
}

/** Writes `.flisk/native/run.json`, creating the run directory and its keep-out-of-git marker. */
export function writeNativeRunState(projectRoot: string, state: NativeRunState): void {
  const dir = join(projectRoot, NATIVE_DIR);
  const logsDir = join(dir, "logs");
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  chmodSync(logsDir, 0o700);
  // Run state and logs are this machine's, never the project's: keep them out of git without touching the user's .gitignore.
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  writeFileSync(nativeRunStatePath(projectRoot), `${JSON.stringify(state, null, 2)}\n`);
}

/** The reason of a live process that has not passed its readiness check yet (the only pending state with a running process). */
export const NATIVE_STARTING_REASON = "starting";

/**
 * Each service's state from the run on record, in the shape `flisk status` reports Tilt's: ready once it passed its readiness
 * check, unhealthy when periodic re-probes keep failing, pending while it starts or the supervisor restarts it, stopped when nothing runs it (#5131). Unknown is only for a
 * check that fails: a run file that exists but cannot be read leaves the state undecided.
 */
export function nativeServiceStates(
  projectRoot: string,
  services: readonly string[],
): Record<string, ServiceRuntimeState> {
  const state = readNativeRunState(projectRoot);
  const isUp = state !== null && isProcessAlive(state.pid);
  const runStateUnreadable = state === null && existsSync(nativeRunStatePath(projectRoot));
  return Object.fromEntries(
    services.map((name) => {
      const service = state?.services[name];
      const withExitCode = <T extends object>(value: T) =>
        service?.lastExitCode === undefined ? value : { ...value, exitCode: service.lastExitCode };
      if (!isUp || !service) {
        return [
          name,
          runStateUnreadable
            ? { status: "unknown", reason: "could not read the run state" }
            : { status: "stopped", reason: "not running" },
        ];
      }
      if (service.failed) {
        return [
          name,
          withExitCode({ status: "error", reason: "exited repeatedly; the supervisor gave up" }),
        ];
      }
      if (!service.pid || !isProcessAlive(service.pid)) {
        // A one-shot job is not restarted: one that exited 0 is done, one that did not has failed.
        if (service.job) {
          return service.ready
            ? [name, { status: "ready", reason: "finished" }]
            : [name, withExitCode({ status: "pending", reason: "the job did not exit 0" })];
        }
        // A "restart": "no" service that exited 0 is done too: its state records ready with no live process (#5120).
        if (service.ready) {
          return [name, { status: "ready", reason: "finished" }];
        }
        if (service.waitingFor?.length) {
          return [
            name,
            withExitCode({
              status: "pending",
              reason: `waiting for ${service.waitingFor.join(", ")}`,
            }),
          ];
        }
        // A record with no pid was never spawned this run (it waits on its dependencies); it is not restarting.
        return [
          name,
          withExitCode({
            status: "pending",
            reason: service.pid === undefined ? "waiting to start" : "restarting",
          }),
        ];
      }
      if (service.unhealthy) {
        return [name, { status: "unhealthy", reason: service.unhealthy }];
      }
      return service.ready
        ? [name, { status: "ready" }]
        : [name, withExitCode({ status: "pending", reason: NATIVE_STARTING_REASON })];
    }),
  );
}

/** One line of a local process's output, as `flisk logs` reports it (the shape of a Tilt log line). */
export interface NativeLogLine {
  /** Written into the log by the supervisor, so it stays the same across reads (omitted in older logs). */
  seq?: number;
  time: string | null;
  resource: string;
  level: null;
  source: null;
  text: string;
  run: string | null;
}

/** Resolves `current`, `previous` and an explicit id against one service's run ids. */
function selectedRunIds(path: string, selector: string | undefined): Set<string> | null {
  if (selector === undefined) return null;
  const ids = nativeRunIds(path);
  if (selector === "current") return new Set(ids.slice(-1));
  if (selector === "previous") return new Set(ids.slice(-2, -1));
  return new Set([String(Number(selector))]);
}

/**
 * The last `tail` lines the given services wrote, oldest first, merged across services by time. `sinceMs` drops lines older
 * than that many milliseconds. `run` selects one run per service (`current`, `previous` or an id); without it every run is
 * returned, as before. A service that wrote nothing yet has no log file and contributes no lines. Supervisor markers are
 * never returned as output (#4693).
 */
export function readNativeLogLines(
  projectRoot: string,
  services: readonly string[],
  options: { tail: number; sinceMs?: number; now?: number; run?: string },
): NativeLogLine[] {
  const cutoff =
    options.sinceMs === undefined ? null : (options.now ?? Date.now()) - options.sinceMs;
  const lines: NativeLogLine[] = [];
  for (const resource of services) {
    const path = nativeLogPath(projectRoot, resource);
    const selected = selectedRunIds(path, options.run);
    // With no run selector only the current file is read, as before; a selected previous run may live in the rotated one.
    const entries = options.run === undefined ? readNativeLogEntries(path) : readNativeRunLog(path);
    const kept = entries
      .filter((entry) => selected === null || (entry.run !== null && selected.has(entry.run)))
      .filter(
        (entry) => cutoff === null || (entry.time !== null && Date.parse(entry.time) >= cutoff),
      )
      .slice(-options.tail);
    for (const entry of kept) {
      lines.push({
        ...(entry.seq === undefined ? {} : { seq: entry.seq }),
        time: entry.time,
        resource,
        level: null,
        source: null,
        text: entry.text,
        run: entry.run,
      });
    }
  }
  // Stable sort: lines of one service keep their order when two share a millisecond.
  lines.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  return lines.slice(-options.tail);
}

const PREFIX_COLORS = [chalk.cyan, chalk.magenta, chalk.green, chalk.yellow, chalk.blue, chalk.red];

/** `name | ` in the service's color, padded so the output of several services lines up. */
export function formatPrefix(name: string, index: number, width: number): string {
  const color = PREFIX_COLORS[index % PREFIX_COLORS.length] ?? chalk.cyan;
  return color(`${name.padEnd(width)} | `);
}
