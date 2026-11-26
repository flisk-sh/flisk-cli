// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  buildTiltDownArgsMock,
  describe,
  downTestContext,
  expect,
  findRunningFliskProjectsMock,
  getContainerRuntimeStatusMock,
  isTiltAvailableMock,
  it,
  join,
  mkdtempSync,
  promptConfirmMock,
  realpathSync,
  rmSync,
  runTiltMock,
  tmpdir,
  vi,
} from "../../test-support/down.js";

describe("flisk down project selection", () => {
  const { scratchProject, downFrom, downFails, originalCwd } = downTestContext();

  it("outside a project refuses to stop a foreign project without consent", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    const project = scratchProject("foreign");
    findRunningFliskProjectsMock.mockResolvedValue([project]);
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      const output = await downFails(elsewhere, []);
      expect(output).toContain(`a different project is running: ${project}`);
      expect(output).toContain(`cd '${project}' && flisk down`);
      expect(output).toContain("flisk down --project");
      expect(promptConfirmMock).not.toHaveBeenCalled();
      expect(runTiltMock).not.toHaveBeenCalled();
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("outside a project dry-runs the only running project without consent", async () => {
    const project = scratchProject("dry-run-foreign");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue([project]);
    try {
      const { output } = await downFrom(elsewhere, ["--dry-run"]);
      expect(runTiltMock).not.toHaveBeenCalled();
      expect(promptConfirmMock).not.toHaveBeenCalled();
      expect(output).toContain(`stopping the one that is running: ${project}`);
      expect(output).toMatch(/Dry run/i);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("outside a project stops the only running project after TTY confirmation", async () => {
    const project = scratchProject("tty-confirm");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue([project]);
    promptConfirmMock.mockResolvedValue(true);
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const { tiltCwd, output } = await downFrom(elsewhere, []);
      expect(promptConfirmMock).toHaveBeenCalledOnce();
      expect(tiltCwd).toBe(project);
      expect(output).toContain(`stopping the one that is running: ${project}`);
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("outside a project stops the only Flisk project that is running, from its folder", async () => {
    const project = scratchProject("running");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue([project]);
    try {
      const { tiltCwd, output } = await downFrom(elsewhere, ["--yes"]);
      expect(tiltCwd).toBe(project);
      expect(output).toContain(`stopping the one that is running: ${project}`);
      expect(promptConfirmMock).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("outside a project lists the running projects instead of guessing when several run", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue(["/work/shop", "/work/blog"]);
    try {
      const output = await downFails(elsewhere, []);
      expect(output).toContain("Not in a Flisk project, and 2 Flisk projects are running");
      expect(output).toContain("flisk down --project /work/shop");
      expect(output).toContain("flisk down --project /work/blog");
      expect(runTiltMock).not.toHaveBeenCalled();
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("--project stops that project from anywhere, and is preferred over a running one", async () => {
    const project = scratchProject("named");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue(["/work/other"]);
    try {
      const { tiltCwd } = await downFrom(elsewhere, ["--yes", "--project", project]);
      expect(tiltCwd).toBe(project);
      expect(findRunningFliskProjectsMock).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("--project reaches down through the root program, which has its own --project", async () => {
    const { createProgram } = await import("../../../program.js");
    const project = scratchProject("via-root");
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    findRunningFliskProjectsMock.mockResolvedValue(["/work/other"]);
    getContainerRuntimeStatusMock.mockReturnValue("running");
    isTiltAvailableMock.mockResolvedValue(true);
    buildTiltDownArgsMock.mockReturnValue(["-f", "/fake/Tiltfile"]);
    let tiltCwd: string | undefined;
    runTiltMock.mockImplementation(async () => {
      tiltCwd = process.cwd();
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(elsewhere);
    try {
      await createProgram().parseAsync(["node", "flisk", "down", "--yes", "--project", project]);
      expect(tiltCwd).toBe(project);
      expect(findRunningFliskProjectsMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      log.mockRestore();
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("--project on a folder that is not a Flisk project fails without running Tilt", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "flisk-down-elsewhere-")));
    try {
      const output = await downFails(elsewhere, ["--project", elsewhere]);
      expect(output).toContain(`No Flisk project at ${elsewhere}`);
      expect(runTiltMock).not.toHaveBeenCalled();
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("inside a project stops that project even when another one is running", async () => {
    const project = scratchProject("here");
    findRunningFliskProjectsMock.mockResolvedValue(["/work/other"]);
    try {
      const { tiltCwd } = await downFrom(project, ["--yes"]);
      expect(tiltCwd).toBe(project);
      expect(findRunningFliskProjectsMock).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
