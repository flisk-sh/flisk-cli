// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native run markers and the --run selector (#4693)", () => {
  native.nativeTestContext();

  it("separates three runs and selects current, previous and an explicit id", () => {
    const root = native.createTempDir();
    const path = native.nativeLogPath(root, "api");
    native.mkdirSync(native.dirname(path), { recursive: true });
    const at = (ms: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString();
    native.writeFileSync(
      path,
      `${[
        `${at(1)} [flisk] run 1 started (pid 111)`,
        `${at(2)} first run`,
        `${at(3)} [flisk] run 1 exited (code 0)`,
        `${at(4)} [flisk] run 2 started (pid 222)`,
        `${at(5)} second run`,
        `${at(6)} [flisk] run 2 exited (code 1)`,
        `${at(7)} [flisk] run 3 started (pid 333)`,
        `${at(8)} third run`,
        `${at(9)} [flisk] run 3 exited (code 0)`,
      ].join("\n")}\n`,
    );

    const all = native.readNativeLogLines(root, ["api"], { tail: 100 });
    expect(all.map((line) => [line.text, line.run])).toEqual([
      ["first run", "1"],
      ["second run", "2"],
      ["third run", "3"],
    ]);
    const texts = (run: string) =>
      native.readNativeLogLines(root, ["api"], { tail: 100, run }).map((line) => line.text);
    expect(texts("current")).toEqual(["third run"]);
    expect(texts("previous")).toEqual(["second run"]);
    expect(texts("1")).toEqual(["first run"]);
  });

  it("marks every spawn and respawn of a crash loop with increasing run ids", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, "crash.mjs"), 'console.log("boom"); process.exit(1);\n');
    const port = await native.freePort();
    const notes: string[] = [];
    const plan = native.planNativeRun([
      native.nativeService(root, "crasher", {
        command: `${native.NODE} crash.mjs`,
        port,
        healthCheckPath: "/health",
      }),
    ]);
    // A crash loop never becomes ready; a short readiness window lets the restarts continue until the supervisor
    // gives up, the only moment the log stops changing.
    const supervisor = new native.NativeSupervisor(
      root,
      plan.services,
      { onNote: (_name, note) => notes.push(note) },
      { readyTimeoutMs: 50, restartDelayMs: 10 },
    );
    native.supervisors.push(supervisor);
    await supervisor.start();
    const path = native.nativeLogPath(root, "crasher");
    // After the give-up note no new run can start, so the log is final once the last run's output has landed.
    await native.waitFor(() => notes.some((note) => note.includes("is not restarted")));
    await native.waitFor(() => {
      const raw = native.readFileSync(path, "utf-8");
      const started = [...raw.matchAll(/\[flisk\] run (\d+) started/g)].map((match) => match[1]);
      return (
        started.length >= 2 &&
        started.every((run) => raw.includes(`[flisk] run ${run} exited (code 1)`)) &&
        native
          .readNativeLogLines(root, ["crasher"], { tail: 100 })
          .map((line) => line.run)
          .join() === started.join()
      );
    });

    const raw = native.readFileSync(path, "utf-8");
    const starts = [...raw.matchAll(/\[flisk\] run (\d+) started \(pid (\d+)\)/g)].map((match) =>
      Number(match[1]),
    );
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (const run of starts) expect(raw).toContain(`[flisk] run ${run} exited (code 1)`);
    expect(
      native.readNativeLogLines(root, ["crasher"], { tail: 100 }).map((line) => line.run),
    ).toEqual(starts.map(String));
  });

  it("keeps output that outlives its run out of the next run's log", async () => {
    const root = native.createTempDir();
    // The parent prints, starts a descendant that inherits stdout (so it holds the pipe open past the parent's exit),
    // and exits: the crash loop restarts the service while the descendant can still write.
    native.writeFileSync(
      native.join(root, "leak.mjs"),
      [
        'import { existsSync, writeFileSync } from "node:fs";',
        'import { spawn } from "node:child_process";',
        'console.log("parent output");',
        'if (!existsSync("spawned")) {',
        '  writeFileSync("spawned", "1");',
        '  spawn(process.execPath, ["leak-child.mjs"], { stdio: ["ignore", "inherit", "inherit"] });',
        "}",
        "process.exit(1);",
      ].join("\n"),
    );
    // Long enough that the run which spawned the descendant is always gone by the time it writes.
    native.writeFileSync(
      native.join(root, "leak-child.mjs"),
      'setTimeout(() => console.log("late from descendant"), 750);\n',
    );
    const port = await native.freePort();
    const lines: string[] = [];
    const plan = native.planNativeRun([
      native.nativeService(root, "leaker", {
        command: `${native.NODE} leak.mjs`,
        port,
        healthCheckPath: "/health",
      }),
    ]);
    const supervisor = new native.NativeSupervisor(
      root,
      plan.services,
      { onLine: (_name, line) => lines.push(line) },
      { readyTimeoutMs: 50, restartDelayMs: 10 },
    );
    native.supervisors.push(supervisor);
    await supervisor.start();
    const path = native.nativeLogPath(root, "leaker");
    // The descendant's line still reaches the terminal while a later run owns the service...
    await native.waitFor(() => lines.some((line) => line.includes("late from descendant")));
    // ...but the log file, where the latest start marker above it would attribute the line to that later run,
    // never records it. The runs' own output stays attributed to the runs that wrote it.
    expect(native.readFileSync(path, "utf-8")).not.toContain("late from descendant");
    const runs = native.readNativeLogLines(root, ["leaker"], { tail: 100 });
    expect(runs.filter((line) => line.text === "parent output").length).toBeGreaterThanOrEqual(2);
    expect(runs.map((line) => line.text)).not.toContain("late from descendant");
  });
});
