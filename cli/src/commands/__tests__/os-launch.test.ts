// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, createTempProject } from "../../test-support/index.js";
import { FliskError } from "../../utils/errors.js";
import { JsonCommandError } from "../../utils/json-command.js";
import { FLISKOS_COMMAND_REQUIRED_CODE, launchFliskOs } from "../os/launch.js";
import type { FliskOsHost } from "../os/surface.js";
import { fakeSpawn, host, onPath, RUNNING } from "./os-fakes.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("launchFliskOs: a thin spawn over the surface", () => {
  it("turns the launch data into exactly one spawn with the caller's terminal", async () => {
    const root = createTempProject();
    const { calls, spawnFn } = fakeSpawn((child) => child.emit("close", 7));
    const launch = await launchFliskOs(
      { port: "5001" },
      { host: onPath("/opt/bin/fliskos"), spawn: spawnFn, cwd: root },
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.command).toBe("/opt/bin/fliskos");
    // The argv is exactly what the pure surface built: nothing added, dropped or reordered by the launcher.
    expect(call?.args).toEqual(["--project", root, "--port", "5001"]);
    expect(call?.options).toEqual({ cwd: root, stdio: "inherit" });
    expect(launch.report).toMatchObject({
      via: "command",
      path: "/opt/bin/fliskos",
      project: root,
    });
    expect(await launch.finished).toBe(7);
  });

  it("resolves relative scan roots against the working folder and leaves absolute ones alone", async () => {
    const dir = createTempDir();
    const { calls, spawnFn } = fakeSpawn();
    await launchFliskOs(
      { scanRoot: ["sibling", "/elsewhere"] },
      { host: onPath("/opt/bin/fliskos"), spawn: spawnFn, cwd: dir },
    );
    expect(calls[0]?.args).toEqual([
      "--scan-root",
      join(dir, "sibling"),
      "--scan-root",
      "/elsewhere",
    ]);
  });

  it("spawns nothing when FliskOS is not installed", async () => {
    const { calls, spawnFn } = fakeSpawn();
    await expect(
      launchFliskOs({}, { host: host(), spawn: spawnFn, cwd: createTempDir() }),
    ).rejects.toMatchObject({ code: "FLISKOS_NOT_INSTALLED", exitCode: 1 });
    expect(calls).toEqual([]);
  });

  it("rejects a mistyped --port before the surface is even built", async () => {
    const { calls, spawnFn } = fakeSpawn();
    await expect(
      launchFliskOs(
        { port: "eighty" },
        { host: onPath("/opt/bin/fliskos"), spawn: spawnFn, cwd: createTempDir() },
      ),
    ).rejects.toThrow(FliskError);
    expect(calls).toEqual([]);
  });

  it("pipes stdout only for --json and fills the report's URL from it", async () => {
    const { calls, spawnFn } = fakeSpawn((child) => {
      child.stdout.emit("data", Buffer.from(`boot\n${RUNNING}ready\n`));
      child.emit("close", 0);
    });
    const launch = await launchFliskOs(
      { json: true },
      { host: onPath("/opt/bin/fliskos"), spawn: spawnFn, cwd: createTempDir() },
    );
    expect(calls[0]?.options.stdio).toEqual(["inherit", "pipe", "inherit"]);
    expect(launch.report.url).toBe("http://127.0.0.1:4321");
    expect(await launch.finished).toBe(0);
  });

  it("turns an early exit into FLISKOS_FAILED carrying the exit code", async () => {
    const { spawnFn } = fakeSpawn((child) => child.emit("close", 23));
    const error = await launchFliskOs(
      { json: true },
      { host: onPath("/opt/bin/fliskos"), spawn: spawnFn, cwd: createTempDir() },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonCommandError);
    expect(error).toMatchObject({ code: "FLISKOS_FAILED", exitCode: 23 });
  });

  it("opens the app through `open -a` and reports the options it ignores", async () => {
    const { calls, spawnFn } = fakeSpawn();
    const appHost = (extra: Partial<FliskOsHost> = {}) =>
      host({ exists: (path) => path === "/Applications/FliskOS.app", ...extra });
    const launch = await launchFliskOs(
      { port: "4300" },
      { host: appHost(), spawn: spawnFn, cwd: createTempDir() },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "open",
      args: ["-a", "FliskOS"],
      options: { stdio: ["ignore", "ignore", "inherit"] },
    });
    expect(launch.report).toMatchObject({ via: "app", url: null, ignored: ["--port"] });
    expect(await launch.finished).toBe(0);
  });

  it("refuses --no-open for the app before calling open", async () => {
    const { calls, spawnFn } = fakeSpawn();
    const appHost = host({ exists: (path) => path === "/Applications/FliskOS.app" });
    await expect(
      launchFliskOs({ open: false }, { host: appHost, spawn: spawnFn, cwd: createTempDir() }),
    ).rejects.toMatchObject({ code: FLISKOS_COMMAND_REQUIRED_CODE });
    expect(calls).toEqual([]);
  });

  it("fails the launch, not the report, when `open` cannot start the app", async () => {
    const { spawnFn } = fakeSpawn((child) => child.emit("close", 1));
    await expect(
      launchFliskOs(
        {},
        {
          host: host({ exists: (path) => path === "/Applications/FliskOS.app" }),
          spawn: spawnFn,
          cwd: createTempDir(),
        },
      ),
    ).rejects.toThrow(/open could not start FliskOS\.app/);
  });
});
