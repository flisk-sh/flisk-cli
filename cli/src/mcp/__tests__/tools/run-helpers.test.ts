// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectFixture,
  fakeChild,
  fakeUp,
  getSpawnMock,
  resetSpawnMock,
} from "./test-support.js";

const spawnMock = getSpawnMock();

beforeEach(() => {
  resetSpawnMock();
});

const fixture = createProjectFixture();

import { FliskError } from "../../../utils/errors.js";

import { defaultUpDeps, runFliskCli, startUp, toTextResult, toToolResult } from "../../tools.js";

describe("runFliskCli", () => {
  it("collects output and the exit code", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const pending = runFliskCli(["status", "--json"], { cwd: "/work", timeoutMs: 5000 });
    child.stdout.emit("data", Buffer.from('{"ok":true}'));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);
    await expect(pending).resolves.toEqual({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: "warn",
    });
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({ cwd: "/work", stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("rejects when the child cannot start", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const pending = runFliskCli([], {});
    child.emit("error", new Error("spawn failed"));
    await expect(pending).rejects.toThrow("spawn failed");
  });
});

describe("defaultUpDeps", () => {
  it("reads missing logs as empty and names a temp log", async () => {
    expect(defaultUpDeps.readLog(join(tmpdir(), `flisk-missing-${Date.now()}.log`))).toBe("");
    expect(defaultUpDeps.logFile()).toContain("flisk-mcp-up-");
    expect(defaultUpDeps.now()).toBeGreaterThan(0);
    await expect(defaultUpDeps.sleep(0)).resolves.toBeUndefined();
  });

  it("starts the CLI detached with the log file as stdio", () => {
    const child = { pid: 9, unref: vi.fn() };
    spawnMock.mockReturnValue(child);
    const log = join(tmpdir(), `flisk-mcp-up-test-${Date.now()}.log`);
    try {
      expect(defaultUpDeps.spawnUp(["up", "--json"], log, "/work")).toBe(child);
      expect(spawnMock).toHaveBeenCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({ cwd: "/work", detached: true }),
      );
      if (process.platform !== "win32") expect(statSync(log).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(log, { force: true });
    }
  });
});

describe("toToolResult", () => {
  const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: "boom" });
  it("passes a clean envelope through as a success", () => {
    const r = toToolResult(run('{"schemaVersion":1,"data":{"ready":false},"errors":[]}\n', 1));
    expect(r.isError).toBe(false);
  });
  it("marks an envelope with errors or ok:false as an error", () => {
    expect(
      toToolResult(run('{"schemaVersion":1,"data":null,"errors":[{"code":"X","message":"m"}]}'))
        .isError,
    ).toBe(true);
    expect(toToolResult(run('{"schemaVersion":1,"data":{"ok":false},"errors":[]}')).isError).toBe(
      true,
    );
  });
  it("uses the last JSON line and reports missing JSON with stderr", () => {
    expect(toToolResult(run('noise\n{"schemaVersion":1,"data":{"a":1},"errors":[]}')).isError).toBe(
      false,
    );
    const none = toToolResult(run("", 2));
    expect(none.isError).toBe(true);
    expect(JSON.stringify(none.data)).toContain("boom");
  });
  it("reports BAD_JSON and the exit code when there is no parseable envelope", () => {
    const bad = toToolResult(run("prefix\n{not json", 0));
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.data)).toContain("BAD_JSON");
    const empty = toToolResult({ exitCode: 3, stdout: "", stderr: "" });
    expect(empty.isError).toBe(true);
    expect(JSON.stringify(empty.data)).toContain("flisk exited with code 3");
  });
  it("reads a pretty-printed envelope (projects, networks) after incidental output", () => {
    const envelope = {
      schemaVersion: 1,
      data: { services: [{ name: "api", status: "stopped" }, {}] },
      errors: [],
    };
    const r = toToolResult(run(`warning: slow\n${JSON.stringify(envelope, null, 2)}\n`));
    expect(r).toEqual({ data: envelope, isError: false });
    const failed = { schemaVersion: 1, data: null, errors: [{ code: "NOT_IN_PROJECT" }] };
    expect(toToolResult(run(JSON.stringify(failed, null, 2), 1))).toEqual({
      data: failed,
      isError: true,
    });
  });
  it("marks a top-level ok:false (runtime --check-assets --json) as an error", () => {
    const r = toToolResult(run('{"ok":false,"assetRoot":null,"missing":["engine"]}', 1));
    expect(r).toEqual({ data: { ok: false, assetRoot: null, missing: ["engine"] }, isError: true });
    expect(toToolResult(run('{"ok":true,"missing":[]}')).isError).toBe(false);
  });
});

describe("toTextResult", () => {
  it("returns the text output, with stderr only when there is some", () => {
    expect(toTextResult({ exitCode: 0, stdout: "  created\n", stderr: "" })).toEqual({
      data: { exitCode: 0, output: "created" },
      isError: false,
    });
  });
  it("is an error result on a non-zero or missing exit code", () => {
    expect(toTextResult({ exitCode: 1, stdout: "", stderr: "❌ Directory exists\n" })).toEqual({
      data: { exitCode: 1, output: "", stderr: "❌ Directory exists" },
      isError: true,
    });
    expect(toTextResult({ exitCode: null, stdout: "partial", stderr: "" }).isError).toBe(true);
  });
});

describe("startUp", () => {
  it("keeps a successful result when the log cannot be removed", async () => {
    const { deps } = fakeUp({
      logs: ['{"schemaVersion":1,"data":{"ok":true},"errors":[]}'],
    });
    deps.logFile = () => tmpdir(); // Removing a directory as a file fails.
    expect((await startUp({}, deps)).isError).toBe(false);
  });

  it("returns an early refusal from the child", async () => {
    const line =
      '{"schemaVersion":1,"data":{"ok":false},"errors":[{"code":"UNKNOWN_SERVICE","message":"nope"}]}';
    const { deps } = fakeUp({ logs: ["", line] });
    const r = await startUp({ only: ["nope"] }, deps);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.data)).toContain("UNKNOWN_SERVICE");
  });
  it("reports a projectPath that does not exist instead of failing to spawn", async () => {
    const { deps, child } = fakeUp({ logs: [""] });
    // Node emits "error" and never "exit" for an ENOENT cwd; with no listener the emit throws and ends the MCP server.
    deps.spawnUp = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("spawn /nosuch ENOENT")));
      return child as never;
    });
    const missing = join(fixture.projectDir, "missing");
    await expect(startUp({ projectPath: missing }, deps)).rejects.toThrow(
      `projectPath does not exist or is not a directory: ${missing}`,
    );
    // The path is checked before the child is started, so the spawn never happens.
    expect(deps.spawnUp).not.toHaveBeenCalled();
  });
  it("reports a failed spawn even when the wait window is zero", async () => {
    const { deps, child } = fakeUp({ logs: [""] });
    deps.spawnUp = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("spawn /nosuch ENOENT")));
      return child as never;
    });
    const r = await startUp({ projectPath: fixture.projectDir, waitSeconds: 0 }, deps);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.data)).toContain("Could not start flisk up");
  });
  it("returns started + a polling hint, and detaches, when nothing happens within the window", async () => {
    const { deps, child, logFile } = fakeUp({ logs: [""] });
    const r = await startUp({ waitSeconds: 3 }, deps);
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ data: { started: true, pid: 4242, logFile } });
    expect(child.unref).toHaveBeenCalled();
  });
  it("reports a child that exits without a result, with the log tail", async () => {
    const { deps } = fakeUp({ logs: ["", "Error: it broke"], exitAfter: { atRead: 2, code: 1 } });
    const r = await startUp({}, deps);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.data)).toContain("it broke");
  });
  it("returns a ready result immediately when the child already printed one", async () => {
    const line = '{"schemaVersion":1,"data":{"ok":true,"services":["api"]},"errors":[]}';
    const { deps } = fakeUp({ logs: [line] });
    expect((await startUp({}, deps)).isError).toBe(false);
  });
  it("removes the log after an early successful result", async () => {
    const logFile = join(tmpdir(), `flisk-mcp-success-${Date.now()}.log`);
    writeFileSync(logFile, '{"schemaVersion":1,"data":{"ok":true},"errors":[]}\n');
    try {
      const { deps } = fakeUp({ logs: [readFileSync(logFile, "utf-8")] });
      deps.logFile = () => logFile;
      const outcome = await startUp({}, deps);
      expect(outcome.isError).toBe(false);
      expect(existsSync(logFile)).toBe(false);
    } finally {
      rmSync(logFile, { force: true });
    }
  });
  it("starts from an explicitly supplied project directory", async () => {
    const { deps, logFile } = fakeUp({
      logs: ['{"schemaVersion":1,"data":{"ok":true},"errors":[]}'],
    });
    await startUp({ projectPath: fixture.projectDir }, deps);
    expect(deps.spawnUp).toHaveBeenCalledWith(["up", "--json"], logFile, fixture.projectDir);
  });
  it("rejects a projectPath that is not a directory", async () => {
    const { deps } = fakeUp({ logs: [""] });
    await expect(startUp({ projectPath: fixture.notADirectory }, deps)).rejects.toThrow(
      `projectPath does not exist or is not a directory: ${fixture.notADirectory}`,
    );
  });
  it("tells the caller to create or pick a directory, not to find an existing project.json", async () => {
    const { deps } = fakeUp({ logs: [""] });
    const err = await startUp({ projectPath: join(fixture.projectDir, "missing") }, deps).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(FliskError);
    const first = (err as FliskError).suggestions[0];
    expect(first).toMatch(/^Create the directory/);
    expect(first).toContain("existing directory");
  });
  it("rejects a projectPath under a file, without starting the child", async () => {
    const { deps } = fakeUp({ logs: [""] });
    // The parent is a file, so the path cannot be a directory. The error says
    // what went wrong - the platform's own, or the missing-directory message -
    // but the child is never started either way.
    const underFile = join(fixture.projectDir, "not-a-directory.txt", "child");
    await expect(startUp({ projectPath: underFile }, deps)).rejects.toThrow();
    expect(deps.spawnUp).not.toHaveBeenCalled();
  });
  it("accepts a projectPath that is a directory", async () => {
    const { deps } = fakeUp({ logs: ['{"schemaVersion":1,"data":{"ok":true},"errors":[]}'] });
    const r = await startUp({ projectPath: fixture.projectDir }, deps);
    expect(r.isError).toBe(false);
    expect(deps.spawnUp).toHaveBeenCalledWith(
      ["up", "--json"],
      expect.any(String),
      fixture.projectDir,
    );
  });

  it("rejects a relative project path and clamps a negative wait window", async () => {
    const relative = fakeUp({ logs: [""] });
    await expect(startUp({ projectPath: "relative" }, relative.deps)).rejects.toThrow(
      "projectPath must be an absolute path",
    );

    const negative = fakeUp({ logs: [""] });
    const result = await startUp({ waitSeconds: -5 }, negative.deps);
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.data)).toContain('"started":true');
  });
});

describe("startUp states (native)", () => {
  const nativeLine = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      schemaVersion: 1,
      data: { ok: true, runtime: "native", services: ["api", "web"], ...extra },
      errors: [],
    });
  const data = (r: { data: unknown }) =>
    (r.data as { data: Record<string, unknown> }).data as Record<string, any>;
  const snapshot = (
    services: Record<string, { status: string; reason?: string; exitCode?: number | null }>,
    logs: Record<string, string[]> = {},
  ) => ({ services, logs }) as never;

  it("reports ready at once for a fast startup", async () => {
    const { deps } = fakeUp({ logs: [nativeLine()] });
    const r = await startUp({}, deps);
    expect(r.isError).toBe(false);
    expect(data(r)).toMatchObject({ state: "ready", ready: true });
  });

  it("reports ready after a slow startup that prints its result several polls later", async () => {
    const { deps } = fakeUp({ logs: ["", "", "", "", nativeLine()] });
    const r = await startUp({ waitForReady: true }, deps);
    expect(r.isError).toBe(false);
    expect(data(r)).toMatchObject({ state: "ready", ready: true });
  });

  it("never reports ready for a Tilt run: it says nothing about readiness", async () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      data: { ok: true, runtime: "tilt" },
      errors: [],
    });
    const { deps } = fakeUp({ logs: [line] });
    const r = await startUp({}, deps);
    expect(data(r).ready).toBeUndefined();
    expect(data(r).state).toBeUndefined();
  });

  it("reports failed with the cause when a service fails immediately", async () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      data: {
        ok: false,
        runtime: "native",
        failures: [
          { name: "api", reason: "exited with code 1", logs: ["FATAL: API_TOKEN is not set"] },
        ],
      },
      errors: [{ code: "UP_RESOURCE_FAILED", message: "api failed" }],
    });
    const { deps } = fakeUp({ logs: [line], exitAfter: { atRead: 1, code: 1 } });
    const r = await startUp({}, deps);
    expect(r.isError).toBe(true);
    expect(data(r)).toMatchObject({ state: "failed", ready: false });
    expect(data(r).failures).toMatchObject([
      {
        name: "api",
        reason: "exited with code 1",
        exitCode: 1,
        code: "CRASH_LOOP",
        suggestions: expect.arrayContaining([expect.stringContaining("flisk logs --service api")]),
      },
    ]);
    expect(JSON.stringify(r.data)).toContain("API_TOKEN is not set");
  });

  it("keeps structured failure metadata from a CLI missing-program result", async () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      data: {
        ok: false,
        runtime: "native",
        failures: [
          {
            name: "api",
            reason: "kept exiting",
            exitCode: 127,
            code: "PROGRAM_NOT_FOUND",
            program: "bun",
            logs: ["sh: bun: command not found"],
          },
        ],
      },
      errors: [{ code: "UP_RESOURCE_FAILED", message: "Local processes did not start" }],
    });
    const { deps } = fakeUp({ logs: [line], exitAfter: { atRead: 1, code: 1 } });
    const r = await startUp({}, deps);
    expect(r.isError).toBe(true);
    expect(data(r).failures).toMatchObject([
      {
        name: "api",
        exitCode: 127,
        code: "PROGRAM_NOT_FOUND",
        program: "bun",
        reason: "kept exiting (bun is not on PATH)",
        suggestions: [
          "Install bun so it is on PATH, then run `flisk up`",
          "Run `flisk doctor` to check your machine",
        ],
      },
    ]);
  });

  it("reports failed again for a repeated failure, not stale readiness", async () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      data: {
        ok: false,
        runtime: "native",
        failures: [{ name: "api", reason: "kept exiting", logs: ["boom (x5)"] }],
      },
      errors: [{ code: "UP_RESOURCE_FAILED", message: "api failed" }],
    });
    for (let i = 0; i < 2; i++) {
      const { deps } = fakeUp({ logs: [line] });
      const r = await startUp({}, deps);
      expect(r.isError).toBe(true);
      expect(data(r).state).toBe("failed");
      expect(JSON.stringify(r.data)).toContain("boom (x5)");
    }
  });

  it("marks a child that dies without a result as failed", async () => {
    const { deps } = fakeUp({ logs: ["", "Error: it broke"], exitAfter: { atRead: 2, code: 1 } });
    const r = await startUp({}, deps);
    expect(r.isError).toBe(true);
    expect(data(r).state).toBe("failed");
  });

  it("returns STARTING, not ready, when the window ends and the run is still coming up", async () => {
    const { deps } = fakeUp({ logs: [""] });
    deps.nativeSnapshot = () => snapshot({ api: { status: "starting" } }, { api: ["warming up"] });
    const r = await startUp({ waitSeconds: 2 }, deps);
    expect(r.isError).toBe(false);
    expect(data(r)).toMatchObject({ state: "starting", ready: false, started: true });
    expect(data(r).services).toEqual({ api: { status: "starting" } });
    expect(data(r).logs).toEqual({ api: ["warming up"] });
  });

  it("returns TIMEOUT as an error when waitForReady runs out, naming what is pending", async () => {
    const { deps } = fakeUp({ logs: [""] });
    deps.nativeSnapshot = () =>
      snapshot(
        {
          base: { status: "ready" },
          api: { status: "error", reason: "kept exiting", exitCode: 127 },
          // What nativeServiceStates reports for a live process whose readiness check has not passed.
          web: { status: "pending", reason: "starting" },
        },
        { api: ["sh: bun: command not found"] },
      );
    const r = await startUp({ waitForReady: true, waitSeconds: 3 }, deps);
    expect(r.isError).toBe(true);
    expect(data(r)).toMatchObject({ state: "timeout", ready: false, started: true });
    expect(data(r).failures).toMatchObject([
      { name: "api", exitCode: 127, code: "PROGRAM_NOT_FOUND", program: "bun" },
      { name: "web", exitCode: null, code: "HEALTHCHECK_FAILED" },
    ]);
    const text = JSON.stringify(r.data);
    expect(text).toContain("UP_NOT_READY_IN_TIME");
    expect(text).toContain("api (kept exiting)");
    expect(text).toContain("web (starting)");
    expect(text).not.toContain("base (");
  });

  it("does not call an already-running stack ready while one dependant is still starting", async () => {
    const { deps } = fakeUp({ logs: [nativeLine({ alreadyRunning: true })] });
    deps.nativeSnapshot = () => snapshot({ api: { status: "ready" }, web: { status: "starting" } });
    const r = await startUp({}, deps);
    expect(data(r)).toMatchObject({ state: "starting", ready: false });
    expect(data(r).services).toMatchObject({ web: { status: "starting" } });
  });

  it("reports an already-running stack as ready when every service is ready", async () => {
    const { deps } = fakeUp({ logs: [nativeLine({ alreadyRunning: true })] });
    deps.nativeSnapshot = () => snapshot({ api: { status: "ready" }, web: { status: "ready" } });
    const r = await startUp({}, deps);
    expect(data(r)).toMatchObject({ state: "ready", ready: true });
  });

  it("keeps waiting past the quick window when waitForReady is set", async () => {
    // 20 polls of 1s each: beyond the 15s default but inside the 120s waitForReady default.
    const { deps } = fakeUp({ logs: [...Array(20).fill(""), nativeLine()] });
    const quick = await startUp({}, deps);
    expect(data(quick).state).toBe("starting");
    const { deps: deps2 } = fakeUp({ logs: [...Array(20).fill(""), nativeLine()] });
    const patient = await startUp({ waitForReady: true }, deps2);
    expect(data(patient).state).toBe("ready");
  });
});
