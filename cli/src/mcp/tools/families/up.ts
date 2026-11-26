// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceRuntimeState } from "../../../types/index.js";
import { cliInvocation } from "../../../utils/cli-invocation.js";
import { createMachineEnvelope } from "../../../utils/machine-output.js";
import {
  isProcessAlive,
  nativeServiceStates,
  readNativeRunState,
} from "../../../utils/native-runtime.js";
import { withFailureLogs } from "../../../utils/native-up.js";
import { findProjectRoot } from "../../../utils/paths.js";
import { redactProjectText } from "../../../utils/secret-redaction.js";
import { withUpFailureCodes } from "../../../utils/up-failure-codes.js";
import type { McpToolResult } from "../../server.js";
import { argSpec, mcpArg, option, positional } from "../../spec-args.js";
import { toToolResult } from "../run.js";
import { flag, projectPath } from "../shared.js";

/** What the supervising `flisk up` has on record while it is still starting the local processes of a project. */
export interface NativeUpSnapshot {
  services: Record<string, ServiceRuntimeState>;
  /** The last lines (own output, secrets masked) of each service that is not ready. */
  logs: Record<string, string[]>;
}

export function readNativeUpSnapshot(projectDir: string, since: number): NativeUpSnapshot | null {
  const root = findProjectRoot(projectDir) ?? projectDir;
  const run = readNativeRunState(root);
  // A run on record from before this start (or whose supervisor is gone) says nothing about it.
  if (!run || !isProcessAlive(run.pid) || Date.parse(run.startedAt) < since - 1000) return null;
  const services = nativeServiceStates(root, Object.keys(run.services));
  const logs: Record<string, string[]> = {};
  for (const [name, state] of Object.entries(services)) {
    if (state.status === "ready") continue;
    const [withLogs] = withFailureLogs(
      root,
      [{ name, reason: state.reason ?? state.status, exitCode: state.exitCode }],
      since,
    );
    if (withLogs?.logs?.length) logs[name] = withLogs.logs;
  }
  return { services, logs };
}

/**
 * The state of a start, in one word. `starting`: launched, readiness not confirmed yet. `ready`: every local process passed its
 * readiness check. `failed`: a process exited or gave up, or `flisk up` ended. `timeout`: readiness was not established within
 * the wait the caller asked for with waitForReady (the stack keeps starting).
 */
export type UpState = "starting" | "ready" | "failed" | "timeout";

function withUpState(result: McpToolResult, state: UpState): McpToolResult {
  const envelope = result.data as { data?: Record<string, unknown> | null } | undefined;
  if (!envelope || typeof envelope !== "object") return result;
  const data: Record<string, unknown> = {
    ...(envelope.data ?? {}),
    state,
    ready: state === "ready",
  };
  // The CLI already classifies its failures; run the same classifier here so an older CLI, a snapshot-built
  // result, or an MCP-only path cannot leave `failures[]` without exitCode/code/suggestions.
  if (Array.isArray(data.failures)) {
    data.failures = withUpFailureCodes(
      data.failures as Array<{ name: string; reason?: string; message?: string; logs?: string[] }>,
    );
  }
  return { ...result, data: { ...envelope, data } };
}

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

export const defaultUpDeps: UpDeps = {
  spawnUp(args, logFile, cwd) {
    const fd = openSync(logFile, "a", 0o600);
    const [command, ...prefix] = cliInvocation();
    const child = spawn(command, [...prefix, ...args], {
      cwd,
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, NO_COLOR: "1" },
    });
    closeSync(fd);
    return child;
  },
  readLog(logFile) {
    try {
      return readFileSync(logFile, "utf-8");
    } catch {
      return "";
    }
  },
  nativeSnapshot: readNativeUpSnapshot,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  logFile: () => join(tmpdir(), `flisk-mcp-up-${Date.now()}.log`),
};

/** The `up` tool's arguments, bound to the `flisk up` spec. */
export const upArgs = argSpec(
  ["up"],
  [
    positional("stack-name", { arg: "stack", description: "Only this stack" }),
    option("--only", {
      description: "Start only these services plus what they depend on and shared infrastructure",
    }),
    option("--profile", {
      description:
        "Also start the services whose profiles in service.json include one of these names (without it they are left out)",
    }),
    option("--env-file", {
      arg: "envFile",
      as: "path",
      description:
        "Use this project env file for the run instead of .env, for example .env.integration",
    }),
    option("--force", { description: "Replace a Tilt that is already running" }),
    option("--dry-run", { arg: "dryRun" }),
    "--json",
    mcpArg("waitForReady", {
      type: "boolean",
      description:
        "Wait until every service passed its readiness check (local-process stacks), instead of only watching for an early failure",
    }),
    mcpArg("waitSeconds", {
      type: "number",
      description:
        "How long to wait before returning (default 15, max 60; with waitForReady default 120, max 600)",
    }),
  ],
);

export function buildUpArgs(args: Record<string, unknown>): string[] {
  return upArgs.build(args);
}

/**
 * Starts the stack detached and returns without waiting for it to be ready (a build can take minutes, longer than a tool
 * call may last). It watches only for an early result, which is how a refusal such as UNKNOWN_SERVICE, TILT_ALREADY_RUNNING
 * or an unsupported host arrives; otherwise the caller polls the `status` tool for `data.tilt.readiness`.
 */
export async function startUp(
  args: Record<string, unknown>,
  deps: UpDeps = defaultUpDeps,
): Promise<McpToolResult> {
  const argv = buildUpArgs(args);
  const logFile = deps.logFile();
  const child = deps.spawnUp(argv, logFile, projectPath(args.projectPath));
  let exited: number | null | undefined;
  child.once("exit", (code) => {
    exited = code;
  });
  // A child that cannot start (a projectPath that does not exist) emits "error" and never "exit"; without a listener that event
  // is thrown and takes the whole MCP server down with it.
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  // Without waitForReady the wait only watches for an early failure; with it, the wait is for readiness itself.
  const waitForReady = flag(args.waitForReady, "waitForReady");
  const [defaultWait, maxWait] = waitForReady ? [120, 600] : [15, 60];
  const waitMs =
    typeof args.waitSeconds === "number"
      ? Math.min(Math.max(args.waitSeconds, 0), maxWait) * 1000
      : defaultWait * 1000;
  const launchedAt = Date.now();
  const deadline = deps.now() + waitMs;
  for (;;) {
    if (spawnError) {
      return toToolResult({
        exitCode: 1,
        stdout: "",
        stderr: `Could not start flisk up: ${spawnError.message}`,
      });
    }
    const log = deps.readLog(logFile);
    const line = log
      .split("\n")
      .filter((l) => l.startsWith('{"schemaVersion"'))
      .pop();
    if (line) {
      const result = toToolResult({
        exitCode: exited ?? null,
        stdout: line,
        stderr: "",
      });
      if (!result.isError) {
        try {
          rmSync(logFile, { force: true });
        } catch {
          // The startup result remains valid if log cleanup is unavailable.
        }
      }
      // A local-process run prints its result only once every service passed its readiness check, so a success is `ready`.
      // The Tilt path prints it at launch: say nothing about readiness there (poll `status`).
      const reported = (
        result.data as {
          data?: { runtime?: string; alreadyRunning?: boolean; dryRun?: boolean } | null;
        }
      ).data;
      if (result.isError) return withUpState(result, "failed");
      if (reported?.runtime !== "native" || reported.dryRun) return { ...result };
      if (!reported.alreadyRunning) return withUpState(result, "ready");
      // The run was already up before this call: what it is doing now is on record, not in this result.
      const current = deps.nativeSnapshot?.(projectPath(args.projectPath) ?? process.cwd(), 0);
      const allReady =
        current !== null &&
        current !== undefined &&
        Object.values(current.services).every((service) => service.status === "ready");
      if (allReady || !current) return withUpState(result, allReady ? "ready" : "starting");
      const starting = withUpState(result, "starting");
      const envelope = starting.data as { data: Record<string, unknown> };
      return {
        ...starting,
        data: {
          ...envelope,
          data: { ...envelope.data, services: current.services, logs: current.logs },
        },
      };
    }
    if (exited !== undefined) {
      return withUpState(
        toToolResult({
          exitCode: exited,
          stdout: "",
          // Masked before it is cut, so the cut cannot shorten a secret out of recognition.
          stderr: redactProjectText(log, projectPath(args.projectPath)).slice(-2000),
        }),
        "failed",
      );
    }
    if (deps.now() >= deadline) {
      // A zero window would otherwise return before a failed spawn has emitted its "error" event.
      await new Promise<void>((done) => setImmediate(done));
      if (spawnError) continue;
      break;
    }
    await deps.sleep(250);
  }
  child.unref();
  const snapshot = deps.nativeSnapshot?.(
    projectPath(args.projectPath) ?? process.cwd(),
    launchedAt,
  );
  const progress = snapshot ? { services: snapshot.services, logs: snapshot.logs } : {};
  if (waitForReady) {
    const notReady = snapshot
      ? Object.entries(snapshot.services).filter(([, service]) => service.status !== "ready")
      : [];
    const pending = notReady.map(
      ([name, service]) => `${name} (${service.reason ?? service.status})`,
    );
    const failures = withUpFailureCodes(
      notReady.map(([name, service]) => ({
        name,
        // A live process whose readiness check has not passed is reported as plain "starting": say what is pending.
        reason:
          service.reason === "starting"
            ? "starting: its readiness check has not passed yet"
            : (service.reason ?? service.status),
        ...(service.exitCode === undefined ? {} : { exitCode: service.exitCode }),
        ...(snapshot?.logs[name] ? { logs: snapshot.logs[name] } : {}),
      })),
    );
    return {
      data: createMachineEnvelope(
        {
          ok: false,
          started: true,
          state: "timeout" satisfies UpState,
          ready: false,
          pid: child.pid ?? null,
          logFile,
          ...progress,
          ...(failures.length > 0 ? { failures } : {}),
          next: "It is still starting and keeps running. Poll status until every service is ready, or call down to stop it. Next time pass a longer waitSeconds with waitForReady.",
        },
        [
          {
            code: "UP_NOT_READY_IN_TIME",
            message: `Not ready after ${Math.round(waitMs / 1000)}s${pending.length > 0 ? `: ${pending.join(", ")}` : ""}.`,
          },
        ],
      ),
      isError: true,
    };
  }
  return {
    data: createMachineEnvelope({
      ok: true,
      started: true,
      state: "starting" satisfies UpState,
      ready: false,
      pid: child.pid ?? null,
      logFile,
      ...progress,
      next: "Started, not confirmed ready. Poll the status tool until every service is ready (data.tilt.readiness.ready for a container stack, data.readiness.ready for a local-process one), or pass waitForReady next time to wait for it. Call down to stop it.",
    }),
    isError: false,
  };
}

/** `up` does not go through the CLI-runner: startUp drives its own detached child and needs the up dependencies. */
export const upRun =
  ({ up }: { up: UpDeps }) =>
  (args: Record<string, unknown>) =>
    startUp(args, up);
