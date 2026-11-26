// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// Unit tests for commands/down/find.ts: which project `flisk down` stops and whether it runs natively. The folder
// walk, the running-project lookup, discovery and the confirm prompt are doubled, so no Docker or project runs.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../../test-support/index.js";

const paths = vi.hoisted(() => ({ findProjectRoot: vi.fn<(from?: string) => string | null>() }));
const cleanup = vi.hoisted(() => ({
  findRunningFliskProjects: vi.fn(async (): Promise<string[]> => []),
}));
const prompt = vi.hoisted(() => ({ promptConfirm: vi.fn(async () => false) }));
const native = vi.hoisted(() => ({ readNativeRunState: vi.fn((): unknown => null) }));
const nativeService = vi.hoisted(() => ({ isNativeProject: vi.fn(() => false) }));
const services = vi.hoisted(() => ({
  discoverResources: vi.fn((): unknown[] => []),
  discoverResourcesFromRoot: vi.fn((): unknown[] => []),
  discoverStacks: vi.fn((): Array<{ name: string }> => []),
}));
const machine = vi.hoisted(() => ({ writeMachineError: vi.fn() }));

// vi.mock factories run before test-support's index loads, so the merge helper is defined here.
const mergeOriginal = vi.hoisted(
  () =>
    async (
      importOriginal: () => Promise<Record<string, unknown>>,
      doubles: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => ({ ...(await importOriginal()), ...doubles }),
);

vi.mock("../../../utils/paths.js", (importOriginal) => mergeOriginal(importOriginal, paths));
vi.mock("../../../utils/down-cleanup.js", (importOriginal) =>
  mergeOriginal(importOriginal, cleanup),
);
vi.mock("../../../utils/prompt.js", (importOriginal) => mergeOriginal(importOriginal, prompt));
vi.mock("../../../utils/native-runtime.js", (importOriginal) =>
  mergeOriginal(importOriginal, native),
);
vi.mock("../../../utils/native-service.js", (importOriginal) =>
  mergeOriginal(importOriginal, nativeService),
);
vi.mock("../../../utils/services.js", (importOriginal) => mergeOriginal(importOriginal, services));
vi.mock("../../../utils/machine-output.js", () => ({ ...machine }));

import { allStackNames, isNativeRun, resolveDownProject } from "../find.js";

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

describe("resolveDownProject", () => {
  beforeEach(() => {
    paths.findProjectRoot.mockReset().mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockReset().mockResolvedValue([]);
    prompt.promptConfirm.mockReset().mockResolvedValue(false);
    machine.writeMachineError.mockReset();
    setStdinTty(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
  });

  it("returns the project around the current folder without asking the process table", async () => {
    paths.findProjectRoot.mockReturnValue("/project");
    await expect(resolveDownProject({})).resolves.toBe("/project");
    expect(cleanup.findRunningFliskProjects).not.toHaveBeenCalled();
  });

  it("resolves --project to the project root found in that folder", async () => {
    // --project 必须先是一个真实存在的目录（#5024），否则连 findProjectRoot 都不会被调用。
    const dir = mkdtempSync(join(tmpdir(), "flisk-down-find-"));
    try {
      paths.findProjectRoot.mockImplementation((from) => (from === dir ? dir : null));
      await expect(resolveDownProject({ project: dir })).resolves.toBe(dir);
      expect(paths.findProjectRoot).toHaveBeenCalledWith(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits with the no-project error when --project names a folder without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-down-find-"));
    const { expectExit } = captureExit();
    const shown: string[] = [];
    vi.spyOn(console, "error").mockImplementation((text) => shown.push(String(text)));
    try {
      paths.findProjectRoot.mockReturnValue(null);
      await expect(resolveDownProject({ project: dir })).rejects.toThrow("process.exit");
      expectExit(1);
      expect(shown.join("\n")).toContain(`No Flisk project at ${dir}`);
      expect(shown.join("\n")).toContain("flisk down --project <path>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the machine error for --project misses in --json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-down-find-"));
    captureExit();
    try {
      paths.findProjectRoot.mockReturnValue(null);
      await expect(resolveDownProject({ project: dir, json: true })).rejects.toThrow(
        "process.exit",
      );
      expect(machine.writeMachineError).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops the only running project with --yes and says which one", async () => {
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue(["/running"]);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    await expect(resolveDownProject({ yes: true })).resolves.toBe("/running");
    expect(printed.join("\n")).toContain("stopping the one that is running: /running");
  });

  it("exits for the only running project when it cannot get consent", async () => {
    const { expectExit } = captureExit();
    const shown: string[] = [];
    vi.spyOn(console, "error").mockImplementation((text) => shown.push(String(text)));
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue(["/running"]);
    await expect(resolveDownProject({})).rejects.toThrow("process.exit");
    expectExit(1);
    expect(shown.join("\n")).toContain("a different project is running: /running");
    expect(shown.join("\n")).toContain("flisk down --project '/running'");
  });

  it("stops the only running project when the prompt confirms", async () => {
    setStdinTty(true);
    prompt.promptConfirm.mockResolvedValue(true);
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue(["/running"]);
    await expect(resolveDownProject({})).resolves.toBe("/running");
    expect(prompt.promptConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not ask consent for a dry run of the only running project", async () => {
    setStdinTty(true);
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue(["/running"]);
    await expect(resolveDownProject({ dryRun: true })).resolves.toBe("/running");
    expect(prompt.promptConfirm).not.toHaveBeenCalled();
  });

  it("exits with one suggestion per root when several projects are running", async () => {
    const { expectExit } = captureExit();
    const shown: string[] = [];
    vi.spyOn(console, "error").mockImplementation((text) => shown.push(String(text)));
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue(["/one", "/two"]);
    await expect(resolveDownProject({})).rejects.toThrow("process.exit");
    expectExit(1);
    expect(shown.join("\n")).toContain("2 Flisk projects are running");
    expect(shown.join("\n")).toContain("flisk down --project /one");
    expect(shown.join("\n")).toContain("flisk down --project /two");
  });

  it("exits with the not-in-project error when nothing runs anywhere", async () => {
    const { expectExit } = captureExit();
    paths.findProjectRoot.mockReturnValue(null);
    cleanup.findRunningFliskProjects.mockResolvedValue([]);
    await expect(resolveDownProject({})).rejects.toThrow("process.exit");
    expectExit(1);
  });
});

describe("isNativeRun", () => {
  beforeEach(() => {
    native.readNativeRunState.mockReset().mockReturnValue(null);
    nativeService.isNativeProject.mockReset().mockReturnValue(false);
    services.discoverResourcesFromRoot.mockReset().mockReturnValue([]);
  });

  it("is true when a native run record exists, without discovery", () => {
    native.readNativeRunState.mockReturnValue({ pid: 1 });
    expect(isNativeRun("/project")).toBe(true);
    expect(services.discoverResourcesFromRoot).not.toHaveBeenCalled();
  });

  it("is true when every service declares a command", () => {
    nativeService.isNativeProject.mockReturnValue(true);
    expect(isNativeRun("/project")).toBe(true);
  });

  it("is false for a container project", () => {
    expect(isNativeRun("/project")).toBe(false);
  });

  it("is false when discovery cannot run", () => {
    services.discoverResourcesFromRoot.mockImplementation(() => {
      throw new Error("broken service.json");
    });
    expect(isNativeRun("/project")).toBe(false);
  });
});

describe("allStackNames", () => {
  beforeEach(() => {
    services.discoverResources.mockReset().mockReturnValue([]);
    services.discoverStacks.mockReset().mockReturnValue([]);
  });

  it("returns the discovered stack names", () => {
    services.discoverStacks.mockReturnValue([{ name: "app" }, { name: "admin" }]);
    expect(allStackNames()).toEqual(["app", "admin"]);
  });

  it("is undefined when the project has no stacks", () => {
    services.discoverStacks.mockReturnValue([]);
    expect(allStackNames()).toBeUndefined();
  });

  it("is undefined when discovery fails", () => {
    services.discoverResources.mockImplementation(() => {
      throw new Error("no project");
    });
    expect(allStackNames()).toBeUndefined();
  });
});
