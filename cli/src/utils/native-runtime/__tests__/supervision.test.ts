// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTempDir } from "../../../test-support/index.js";
import type { NativeServicePlan } from "../plan.js";
import { STARTUP_ERROR_REASON } from "../startup-error.js";
import { NATIVE_DIR, nativeControlDir, writeNativeRunState } from "../state.js";
import {
  requestNativeRestart,
  restartSupervisedService,
  STOP_TIMEOUT_MS,
  type SupervisorRestartHost,
  shellInvocation,
  signalGroup,
  stopNativeRun,
  stopProcessGroup,
  terminateSupervisorProcess,
  watchRestartRequests,
  writeRestartResult,
} from "../supervision.js";
import type { RunningService } from "../types.js";

const basePlan = (over: Partial<NativeServicePlan> = {}): NativeServicePlan => ({
  name: "api",
  command: "node s.js",
  cwd: "/tmp/api",
  env: {},
  dependsOn: [],
  restart: true,
  ...over,
});

const baseService = (over: Partial<RunningService> = {}): RunningService => ({
  plan: basePlan(),
  startedAt: 0,
  quickCrashes: 0,
  reprobeFailures: 0,
  gaveUp: false,
  isReady: false,
  lastExitCode: null,
  ...over,
});

const fakeHost = (
  service: RunningService | undefined,
  over: Partial<SupervisorRestartHost> = {},
) => {
  const notes: string[] = [];
  const spawned: string[] = [];
  const host: SupervisorRestartHost = {
    projectRoot: createTempDir(),
    serviceNamed: () => service,
    isStopping: () => false,
    refreshPlan: () => undefined,
    spawn: (s) => spawned.push(s.plan.name),
    saveState: () => {},
    note: (_name, message) => notes.push(message),
    resumed: () => {},
    ...over,
  };
  return { host, notes, spawned };
};

describe("supervision cluster interface", () => {
  it("exports the stop and steering surface", () => {
    for (const fn of [
      requestNativeRestart,
      restartSupervisedService,
      shellInvocation,
      signalGroup,
      stopNativeRun,
      stopProcessGroup,
      terminateSupervisorProcess,
      watchRestartRequests,
      writeRestartResult,
    ]) {
      expect(typeof fn).toBe("function");
    }
    expect(typeof STOP_TIMEOUT_MS).toBe("number");
  });
});

describe("shellInvocation", () => {
  it("runs a command through the platform shell the way Node's shell true does", () => {
    expect(shellInvocation("npm run dev", "linux")).toEqual({
      file: "/bin/sh",
      args: ["-c", "npm run dev"],
      windowsVerbatimArguments: false,
    });
    expect(shellInvocation("npm run dev", "win32", "C:\\Windows\\cmd.exe")).toEqual({
      file: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", '"npm run dev"'],
      windowsVerbatimArguments: true,
    });
  });
});

describe("signalGroup", () => {
  it("kills the process group on POSIX and the tree on Windows", async () => {
    const killTree = vi.fn();
    signalGroup(1234, "SIGTERM", "win32", killTree);
    expect(killTree).toHaveBeenCalledWith(1234);

    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      detached: true,
    });
    try {
      expect(child.pid).toBeDefined();
      const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
        child.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal])),
      );
      signalGroup(child.pid as number, "SIGTERM");
      expect(await exited).toEqual([null, "SIGTERM"]);
    } finally {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });
});

describe("terminateSupervisorProcess", () => {
  it("ends the tree on Windows and signals the pid on POSIX", async () => {
    const killTree = vi.fn();
    await terminateSupervisorProcess(1234, 50, "win32", killTree);
    expect(killTree).toHaveBeenCalledWith(1234);

    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    try {
      const exited = new Promise<number | null>((resolve) =>
        child.once("exit", (code) => resolve(code)),
      );
      await terminateSupervisorProcess(child.pid as number, 5_000);
      expect(await exited).toBeNull();
    } finally {
      try {
        process.kill(child.pid as number, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });
});

describe("stopNativeRun", () => {
  it("reports not-running with no run.json and stale for a pre-boot run", async () => {
    const root = createTempDir();
    expect(await stopNativeRun(root)).toEqual({ wasRunning: false, services: [] });

    writeNativeRunState(root, {
      pid: 999,
      startedAt: new Date(Date.now() - 365 * 24 * 3_600_000).toISOString(),
      services: {},
    });
    const stale = await stopNativeRun(root);
    expect(stale).toEqual({ wasRunning: false, stale: true, services: [] });
    expect(existsSync(join(root, NATIVE_DIR, "run.json"))).toBe(false);
  });

  it("stops the recorded supervisor and services, honouring start-time identity", async () => {
    const root = createTempDir();
    writeNativeRunState(root, {
      pid: 31337,
      pidStartTime: "sup-t",
      startedAt: new Date().toISOString(),
      services: {
        api: { pid: 40001, startTime: "api-t", ready: true },
        reused: { pid: 40002, startTime: "old-t" },
      },
    });
    const calls: string[] = [];
    const result = await stopNativeRun(root, {
      deps: {
        isAlive: () => true,
        startTimeOf: async (pid) => (pid === 40001 ? "api-t" : pid === 31337 ? "sup-t" : "other"),
        bootTimeMs: () => 0,
        terminateSupervisor: async (pid) => {
          calls.push(`term:${pid}`);
        },
        stopGroup: async (pid) => {
          calls.push(`stop:${pid}`);
        },
      },
    });
    expect(result.wasRunning).toBe(true);
    expect(result.supervisorPid).toBe(31337);
    expect(result.services).toEqual(["api"]);
    expect(calls).toEqual(["term:31337", "stop:40001"]);
    expect(existsSync(join(root, NATIVE_DIR, "run.json"))).toBe(false);
  });
});

describe("the restart request channel", () => {
  it("reports not-running when no supervisor is on record", async () => {
    const root = createTempDir();
    expect(await requestNativeRestart(root, "api", { waitMs: 100 })).toEqual({
      state: "not-running",
      reason: "no local processes of this project are running",
    });
  });

  it("writes the request file and returns the answer the supervisor wrote", async () => {
    const root = createTempDir();
    writeNativeRunState(root, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      services: {},
    });
    const dir = nativeControlDir(root);
    const answering = setInterval(() => {
      if (!existsSync(dir)) return;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".req.json")) continue;
        const id = file.replace(/\.req\.json$/, "");
        writeFileSync(join(dir, `${id}.res.json`), JSON.stringify({ state: "ready", pid: 42 }));
      }
    }, 30);
    try {
      const result = await requestNativeRestart(root, "api", { waitMs: 5_000 });
      expect(result).toEqual({ state: "ready", pid: 42 });
    } finally {
      clearInterval(answering);
    }
  });

  it("polls request files into onRequest calls and writes results the requester reads", async () => {
    const root = createTempDir();
    const dir = join(root, NATIVE_DIR, "control");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "abc.req.json"), JSON.stringify({ id: "abc", service: "api" }));
    writeFileSync(join(dir, "bad.req.json"), "not json");

    const seen: string[] = [];
    const timer = watchRestartRequests(
      dir,
      () => false,
      (service, id) => {
        seen.push(`${service}:${id}`);
      },
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(seen).toEqual(["api:abc"]);
      expect(existsSync(join(dir, "abc.req.json"))).toBe(false);

      writeRestartResult(root, "abc", { state: "ready", pid: 42 });
      expect(JSON.parse(readFileSync(join(dir, "abc.res.json"), "utf-8"))).toEqual({
        state: "ready",
        pid: 42,
      });
    } finally {
      clearInterval(timer);
    }
  });
});

describe("restartSupervisedService", () => {
  it("fails for a service outside the run, a container and an in-flight restart", async () => {
    const { host } = fakeHost(undefined);
    expect(await restartSupervisedService(host, "nope", "r1")).toMatchObject({
      state: "failed",
      reason: '"nope" is not part of this run',
    });

    const container = baseService({ plan: basePlan({ container: "proj-db-1" }) });
    expect(await restartSupervisedService(fakeHost(container).host, "api", "r2")).toMatchObject({
      state: "failed",
      reason: '"api" runs as a container (docker run); restart the whole run with up and force',
    });

    const busy = baseService({ restarting: true });
    expect(await restartSupervisedService(fakeHost(busy).host, "api", "r3")).toMatchObject({
      state: "failed",
      reason: '"api" is already being restarted',
    });
  });

  it("stops, respawns and reports a one-shot job ready once it exits 0", async () => {
    const service = baseService({
      plan: basePlan({ job: true, restart: false }),
      exited: Promise.resolve(0),
    });
    const { host, notes, spawned } = fakeHost(service);
    const result = await restartSupervisedService(host, "api", "r4");
    expect(result.state).toBe("ready");
    expect(spawned).toEqual(["api"]);
    expect(notes).toContain("restarting (requested)");
    expect(notes).toContain("ready again");
  });

  it("keeps the previous plan when the refresh cannot bind", async () => {
    const service = baseService({
      plan: basePlan({ job: true }),
      exited: Promise.resolve(0),
    });
    const { host, notes } = fakeHost(service, { refreshPlan: () => "an output vanished" });
    await restartSupervisedService(host, "api", "r5");
    expect(notes).toContain("restart kept the previous plan: an output vanished");
  });

  it("fails fast instead of timing out when the restarted service went quiet after a startup error", async () => {
    // A watcher-held service: the process is still running, it logged its error a quiet window ago,
    // and the port never answers, so the wait ends on the error instead of the timeout (#5038).
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const service = baseService({
      plan: basePlan({ port }),
      child: { exitCode: null, signalCode: null } as ChildProcess,
      sawStartupError: true,
      lastOutputAt: Date.now() - 60_000,
    });
    const { host } = fakeHost(service, { startupErrorQuietMs: 300 });
    const result = await restartSupervisedService(host, "api", "r6");
    expect(result).toMatchObject({ state: "failed", reason: STARTUP_ERROR_REASON });
  });
});
