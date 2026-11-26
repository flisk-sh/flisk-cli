// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir } from "../../../test-support/index.js";
import { processStartTime } from "../../process-identity.js";
import {
  formatPrefix,
  isNativeRunSupervisorAlive,
  NATIVE_DIR,
  type NativeRunState,
  nativeControlDir,
  nativeLogPath,
  nativeRunStatePath,
  nativeServiceStates,
  readNativeLogLines,
  readNativeRunState,
  runServicesRecord,
  writeNativeRunState,
} from "../state.js";

const runState = (over: Partial<NativeRunState> = {}): NativeRunState => ({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  services: {},
  ...over,
});

describe("state cluster interface", () => {
  it("exports the state and query surface", () => {
    for (const fn of [
      formatPrefix,
      isNativeRunSupervisorAlive,
      nativeControlDir,
      nativeLogPath,
      nativeRunStatePath,
      nativeServiceStates,
      readNativeLogLines,
      readNativeRunState,
      runServicesRecord,
      writeNativeRunState,
    ]) {
      expect(typeof fn).toBe("function");
    }
    expect(typeof NATIVE_DIR).toBe("string");
  });
});

describe("run state paths", () => {
  it("places run.json, logs and the control dir under .flisk/native", () => {
    expect(nativeRunStatePath("/proj")).toBe(join("/proj", NATIVE_DIR, "run.json"));
    expect(nativeLogPath("/proj", "api")).toBe(join("/proj", NATIVE_DIR, "logs", "api.log"));
    expect(nativeControlDir("/proj")).toBe(join("/proj", NATIVE_DIR, "control"));
  });
});

describe("readNativeRunState and writeNativeRunState", () => {
  it("round-trips a run state and creates the keep-out-of-git marker", () => {
    const root = createTempDir();
    const state = runState({ services: { api: { pid: 1234, port: 4100, ready: true } } });
    writeNativeRunState(root, state);
    expect(readNativeRunState(root)).toEqual(state);
    expect(readFileSync(join(root, NATIVE_DIR, ".gitignore"), "utf-8")).toBe("*\n");
    expect(existsSync(join(root, NATIVE_DIR, "logs"))).toBe(true);
  });

  it("returns null for a missing or malformed run.json", () => {
    const root = createTempDir();
    expect(readNativeRunState(root)).toBeNull();
    mkdirSync(join(root, NATIVE_DIR), { recursive: true });
    writeFileSync(nativeRunStatePath(root), "not json");
    expect(readNativeRunState(root)).toBeNull();
    writeFileSync(nativeRunStatePath(root), JSON.stringify({ pid: "x" }));
    expect(readNativeRunState(root)).toBeNull();
  });
});

describe("isNativeRunSupervisorAlive", () => {
  it("accepts the recorded process and rejects a reused or unrecorded pid", async () => {
    const startTime = await processStartTime(process.pid);
    expect(startTime).toBeDefined();
    const state = runState({ pidStartTime: startTime });
    expect(await isNativeRunSupervisorAlive(state)).toBe(true);
    expect(await isNativeRunSupervisorAlive({ ...state, pidStartTime: "reused" })).toBe(false);
    expect(await isNativeRunSupervisorAlive(runState())).toBe(false);
    expect(await isNativeRunSupervisorAlive(null)).toBe(false);
  });
});

describe("runServicesRecord", () => {
  it("maps the live service record into the recorded shape", () => {
    const record = runServicesRecord(
      new Map([
        [
          "api",
          {
            child: { pid: 4321 },
            startTime: "t-1",
            plan: { port: 4100, url: "http://localhost:4100" },
            isReady: true,
            gaveUp: false,
          },
        ],
        [
          "migrate",
          {
            plan: { job: true },
            isReady: true,
            gaveUp: false,
          },
        ],
        [
          "worker",
          {
            plan: {},
            isReady: false,
            gaveUp: true,
            waitingFor: ["db"],
          },
        ],
      ]),
    );
    expect(record.api).toEqual({
      pid: 4321,
      startTime: "t-1",
      port: 4100,
      url: "http://localhost:4100",
      ready: true,
    });
    expect(record.migrate).toEqual({ pid: undefined, ready: true, job: true });
    expect(record.worker).toEqual({
      pid: undefined,
      ready: false,
      waitingFor: ["db"],
      failed: true,
    });
  });
});

describe("nativeServiceStates", () => {
  it("reports ready, pending, error and stopped from the run on record", () => {
    const root = createTempDir();
    writeNativeRunState(
      root,
      runState({
        services: {
          up: { pid: process.pid, ready: true },
          starting: { pid: process.pid, ready: false },
          crashed: { failed: true },
          job: { job: true, ready: true },
          waiting: { waitingFor: ["db"] },
          queued: { ready: false },
        },
      }),
    );
    const states = nativeServiceStates(root, [
      "up",
      "starting",
      "crashed",
      "job",
      "waiting",
      "queued",
      "gone",
    ]);
    expect(states.up).toEqual({ status: "ready" });
    expect(states.starting).toEqual({ status: "pending", reason: "starting" });
    expect(states.crashed).toEqual({
      status: "error",
      reason: "exited repeatedly; the supervisor gave up",
    });
    expect(states.job).toEqual({ status: "ready", reason: "finished" });
    expect(states.waiting).toEqual({ status: "pending", reason: "waiting for db" });
    // A service the run never spawned is not "restarting": it waits on its dependencies (#5109).
    expect(states.queued).toEqual({ status: "pending", reason: "waiting to start" });
    expect(states.gone).toEqual({ status: "stopped", reason: "not running" });
  });

  it("reports stopped when no supervisor is on record", () => {
    const root = createTempDir();
    writeNativeRunState(root, runState({ pid: 4_000_000_000 }));
    expect(nativeServiceStates(root, ["api"])).toEqual({
      api: { status: "stopped", reason: "not running" },
    });
  });

  it("reports stopped when there is no run state at all", () => {
    const root = createTempDir();
    expect(nativeServiceStates(root, ["api"])).toEqual({
      api: { status: "stopped", reason: "not running" },
    });
  });

  it("reports unknown only when the run state cannot be read", () => {
    const root = createTempDir();
    mkdirSync(join(root, NATIVE_DIR), { recursive: true });
    writeFileSync(nativeRunStatePath(root), "{not json");
    expect(nativeServiceStates(root, ["api"])).toEqual({
      api: { status: "unknown", reason: "could not read the run state" },
    });
  });
});

describe("readNativeLogLines", () => {
  const stamp = (iso: string, seq: number, text: string) => `${iso} #${seq} ${text}`;

  it("merges services by time, newest last, honoring tail and sinceMs", () => {
    const root = createTempDir();
    const logsDir = join(root, NATIVE_DIR, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(
      join(logsDir, "api.log"),
      [
        stamp("2026-01-01T00:00:01.000Z", 1, "api first"),
        stamp("2026-01-01T00:00:03.000Z", 3, "api last"),
      ].join("\n"),
    );
    writeFileSync(
      join(logsDir, "web.log"),
      `${stamp("2026-01-01T00:00:02.000Z", 2, "web middle")}\nold unformatted line\n`,
    );
    const lines = readNativeLogLines(root, ["api", "web", "silent"], { tail: 10 });
    expect(lines.map((line) => [line.resource, line.text])).toEqual([
      ["web", "old unformatted line"],
      ["api", "api first"],
      ["web", "web middle"],
      ["api", "api last"],
    ]);
    const seqs = lines.map((line) => line.seq);
    expect(seqs[1]).toBe(1);
    const recent = readNativeLogLines(root, ["api", "web"], {
      tail: 10,
      sinceMs: 1_000,
      now: Date.parse("2026-01-01T00:00:03.000Z"),
    });
    expect(recent.map((line) => line.text)).toEqual(["web middle", "api last"]);
    const tail = readNativeLogLines(root, ["api", "web"], { tail: 1 });
    expect(tail.map((line) => line.text)).toEqual(["api last"]);
  });
});

describe("formatPrefix", () => {
  it("pads the name and ends with a separator", () => {
    expect(formatPrefix("api", 0, 8)).toContain("api      | ");
    expect(formatPrefix("w", 1, 3)).toContain("w   | ");
  });
});
