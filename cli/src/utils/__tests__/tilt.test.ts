// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock findProjectRoot to return a controlled path for all tests
vi.mock("../paths.js", () => ({
  findProjectRoot: vi.fn(),
  getPackageVersion: vi.fn(() => "1.1.0"),
}));

const { spawnMock, findOnPathMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  findOnPathMock: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../which.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../which.js")>();
  findOnPathMock.mockImplementation(actual.findOnPath);
  return { ...actual, findOnPath: findOnPathMock };
});

import { findProjectRoot } from "../paths.js";

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("getTiltfilePath", () => {
  beforeEach(() => {
    vi.mocked(findProjectRoot).mockReturnValue("/fake/project");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return correct tiltfile path for valid project", async () => {
    const { getTiltfilePath } = await import("../tilt.js");
    const tiltfilePath = getTiltfilePath();
    expect(tiltfilePath).toBe(join("/fake/project", ".flisk", ".flisk-out", "Tiltfile"));
  });

  it("should not have double slashes in path", async () => {
    const { getTiltfilePath } = await import("../tilt.js");
    // Ensure root doesn't have trailing slash
    const tiltfilePath = getTiltfilePath();
    expect(tiltfilePath).not.toContain("//");
  });
});

describe("getTiltfilePath error", () => {
  beforeEach(() => {
    vi.mocked(findProjectRoot).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should throw the shared not-in-project error with suggestions", async () => {
    const { getTiltfilePath } = await import("../tilt.js");
    let error: unknown;
    try {
      getTiltfilePath();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Could not find project root (no .flisk/project.json found)",
    );
    expect((error as { suggestions: string[] }).suggestions).toEqual([
      "Run this from within a Flisk project",
      "Run `flisk project --yes` to initialize a new project",
    ]);
  });
});

describe("buildTiltUpArgs", () => {
  beforeEach(() => {
    vi.mocked(findProjectRoot).mockReturnValue("/fake/project");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should include -f flag with tiltfile path", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs(["service-a", "service-b"], {});
    expect(args).toContain("-f");
    const fIndex = args.indexOf("-f");
    expect(fIndex).toBeGreaterThanOrEqual(0);
    expect(args[fIndex + 1]).toContain(join(".flisk", ".flisk-out", "Tiltfile"));
  });

  it("should include service names in order", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs(["service-a", "service-b"], {});
    expect(args).toContain("service-a");
    expect(args).toContain("service-b");
  });

  it("should include --verbose flag when verbose is set", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs([], { verbose: true });
    expect(args).toContain("--verbose");
  });

  it("should NOT include --verbose when quiet is set even if verbose is true", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs([], { verbose: true, quiet: true });
    expect(args).not.toContain("--verbose");
  });

  it("should include --watch flag when watch is set", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs([], { watch: true });
    expect(args).toContain("--watch");
  });

  it("should order args: -f, tiltfile, services, options", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs(["svc-a", "svc-b"], { verbose: true });
    expect(args[0]).toBe("-f");
    expect(args[1]).toContain("Tiltfile");
    expect(args[2]).toBe("svc-a");
    expect(args[3]).toBe("svc-b");
    expect(args[4]).toBe("--verbose");
  });

  it("should call findProjectRoot once", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    buildTiltUpArgs([], {});
    expect(findProjectRoot).toHaveBeenCalledTimes(1);
  });

  it("should include -- --focus=<stack> before service names when focusTargets is set", async () => {
    // Regression test: `flisk up <stack>` used to pass only bare positional service
    // names, which the generated Tiltfile's focus filter never reads (it only reads
    // --focus), so it silently fell back to building every stack instead of the one
    // requested. --focus must be present, carry the stack name, and be preceded by
    // `--` (tilt up rejects "--focus" as an unrecognized top-level flag otherwise -
    // `--` is what routes it to the Tiltfile's own config.parse()).
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs(["finance-api", "finance-app"], { focusTargets: ["finance"] });
    const dashDashIndex = args.indexOf("--");
    expect(dashDashIndex).toBeGreaterThanOrEqual(0);
    expect(args[dashDashIndex + 1]).toBe("--focus=finance");
    expect(args.indexOf("--focus=finance")).toBeLessThan(args.indexOf("finance-api"));
  });

  it("should join multiple focusTargets with commas in a single --focus flag", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const args = buildTiltUpArgs([], { focusTargets: ["finance", "hr"] });
    expect(args).toContain("--focus=finance,hr");
  });

  it("should NOT include --focus when focusTargets is empty or omitted", async () => {
    const { buildTiltUpArgs } = await import("../tilt.js");
    const withEmpty = buildTiltUpArgs(["svc"], { focusTargets: [] });
    const withOmitted = buildTiltUpArgs(["svc"], {});
    expect(withEmpty.some((a) => a.startsWith("--focus"))).toBe(false);
    expect(withOmitted.some((a) => a.startsWith("--focus"))).toBe(false);
  });
});

describe("buildTiltDownArgs", () => {
  beforeEach(() => {
    vi.mocked(findProjectRoot).mockReturnValue("/fake/project");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should include -f flag with tiltfile path", async () => {
    const { buildTiltDownArgs } = await import("../tilt.js");
    const args = buildTiltDownArgs({});
    expect(args).toContain("-f");
  });

  it("should not pass --force to tilt down even when force is set", async () => {
    // Regression test for issue #1216: tilt down has no --force flag and fails
    // with "unknown flag: --force" if passed.
    const { buildTiltDownArgs } = await import("../tilt.js");
    const argsWithForce = buildTiltDownArgs({ force: true });
    const argsWithoutForce = buildTiltDownArgs({});
    expect(argsWithForce).not.toContain("--force");
    expect(argsWithoutForce).not.toContain("--force");
  });

  it("passes every stack to the Tiltfile after -- so tilt down registers stack compose projects", async () => {
    const { buildTiltDownArgs } = await import("../tilt.js");
    const args = buildTiltDownArgs({ focusTargets: ["shop", "billing"] });
    expect(args.slice(-2)).toEqual(["--", "--focus=shop,billing"]);
  });

  it("adds no Tiltfile arguments when there are no stacks", async () => {
    const { buildTiltDownArgs } = await import("../tilt.js");
    expect(buildTiltDownArgs({ focusTargets: [] })).not.toContain("--");
  });
});

describe("runTilt", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  it("collects stdout, stderr and the exit code", async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("tilt v0.37.7"));
        child.stderr.emit("data", Buffer.from("warning: config"));
        child.emit("close", 0);
      });
      return child;
    });
    const { runTilt } = await import("../tilt.js");

    await expect(runTilt("version", ["--port", "10350"])).resolves.toEqual({
      exitCode: 0,
      stdout: "tilt v0.37.7",
      stderr: "warning: config",
    });
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(["version", "--port", "10350"]);
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ stdio: "pipe", shell: false }),
    );
  });

  it("defaults to exit code 1 when the process is terminated by a signal", async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", null));
      return child;
    });
    const { runTilt } = await import("../tilt.js");

    await expect(runTilt("version")).resolves.toMatchObject({ exitCode: 1 });
  });

  it("inherits stdio and skips stream capture when requested", async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("ignored"));
        child.emit("close", 0);
      });
      return child;
    });
    const { runTilt } = await import("../tilt.js");

    await expect(runTilt("up", [], { inheritStdio: true })).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ stdio: "inherit" }));
  });

  it("logs the resolved command in verbose mode", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const { runTilt } = await import("../tilt.js");

    await runTilt("version", ["--port", "10350"], { verbose: true });

    expect(log).toHaveBeenCalledWith("Executing: tilt version --port 10350");
  });

  it("rejects when the Tilt binary cannot be spawned", async () => {
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit("error", new Error("spawn tilt ENOENT")));
      return child;
    });
    const { runTilt } = await import("../tilt.js");

    await expect(runTilt("version")).rejects.toThrow("Failed to spawn tilt: spawn tilt ENOENT");
  });
});

describe("isTiltAvailable", () => {
  const originalPath = process.env.PATH;
  const directories: string[] = [];
  let fakePath: string;

  beforeEach(async () => {
    // The availability result is memoised for the life of the process, so each
    // case needs a fresh module instance as well as a fresh fake PATH.
    vi.resetModules();
    // Earlier suites call vi.restoreAllMocks(), which clears a vi.fn()'s
    // implementation as well; restore the real PATH lookup for this suite.
    const actualWhich = await vi.importActual<typeof import("../which.js")>("../which.js");
    spawnMock.mockReset();
    findOnPathMock.mockReset().mockImplementation(actualWhich.findOnPath);
    fakePath = mkdtempSync(join(tmpdir(), "flisk-tilt-path-"));
    directories.push(fakePath);
    process.env.PATH = fakePath;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("is true from a PATH lookup without spawning tilt version", async () => {
    writeFileSync(join(fakePath, "tilt"), "");
    const { isTiltAvailable } = await import("../tilt.js");

    await expect(isTiltAvailable()).resolves.toBe(true);
    expect(findOnPathMock).toHaveBeenCalledWith("tilt");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("is false when tilt is absent from PATH without spawning tilt version", async () => {
    const { isTiltAvailable } = await import("../tilt.js");

    await expect(isTiltAvailable()).resolves.toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("looks up tilt once when called twice in one process", async () => {
    writeFileSync(join(fakePath, "tilt"), "");
    const { isTiltAvailable } = await import("../tilt.js");

    await expect(isTiltAvailable()).resolves.toBe(true);
    await expect(isTiltAvailable()).resolves.toBe(true);
    expect(findOnPathMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rechecks PATH after the cache is reset", async () => {
    const { isTiltAvailable, resetTiltAvailabilityCache } = await import("../tilt.js");

    await expect(isTiltAvailable()).resolves.toBe(false);
    writeFileSync(join(fakePath, "tilt"), "");
    resetTiltAvailabilityCache();
    await expect(isTiltAvailable()).resolves.toBe(true);
    expect(findOnPathMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
