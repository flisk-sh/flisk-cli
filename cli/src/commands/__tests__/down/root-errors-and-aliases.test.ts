// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  buildTiltDownArgs,
  describe,
  downCommand,
  downTestContext,
  expect,
  expectDeprecatedAliasBehavior,
  expectDownTiltInvocation,
  getContainerRuntimeStatusMock,
  isTiltAvailableMock,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  rmSync,
  runTiltMock,
  setupDownAliasTest,
  tmpdir,
  vi,
  writeFileSync,
} from "../../test-support/down.js";

describe("flisk down root errors and confirmation aliases", () => {
  const { originalCwd } = downTestContext();

  it("prints the shared project-root error before checking prerequisites outside a project", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "flisk-down-test-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:1");
    }) as never);
    process.chdir(tempDir);

    try {
      await expect(downCommand.parseAsync(["node", "flisk"], { from: "node" })).rejects.toThrow(
        "exit:1",
      );

      const output = error.mock.calls.flat().join("\n");
      expect(output).toContain("Could not find project root (no .flisk/project.json found)");
      expect(output).toContain("Run this from within a Flisk project");
      expect(output).toContain("Run `flisk project --yes` to initialize a new project");
      expect(output).toContain("flisk down --project <path>");
      expect(runTiltMock).not.toHaveBeenCalled();
      expect(getContainerRuntimeStatusMock).not.toHaveBeenCalled();
      expect(isTiltAvailableMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it("emits one machine-readable project-root error before prerequisites in JSON mode", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "flisk-down-json-test-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:1");
    }) as never);
    process.chdir(tempDir);

    try {
      await expect(
        downCommand.parseAsync(["node", "flisk", "--json"], { from: "node" }),
      ).rejects.toThrow("exit:1");

      expect(log).toHaveBeenCalledTimes(1);
      const report = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(report).toMatchObject({
        schemaVersion: 1,
        data: null,
        errors: [
          {
            code: "NOT_IN_PROJECT",
            message: "Could not find project root (no .flisk/project.json found)",
            suggestions: [
              "Run this from within a Flisk project",
              "Run `flisk project --yes` to initialize a new project",
              "Or name the project to stop from anywhere: flisk down --project <path>",
            ],
          },
        ],
      });
      expect(error).toHaveBeenCalledWith(
        "Could not find project root (no .flisk/project.json found)",
      );
      expect(runTiltMock).not.toHaveBeenCalled();
      expect(getContainerRuntimeStatusMock).not.toHaveBeenCalled();
      expect(isTiltAvailableMock).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("prints the dry-run plan without building arguments or invoking Tilt", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "flisk-down-dry-run-test-"));
    mkdirSync(join(tempDir, ".flisk"), { recursive: true });
    writeFileSync(join(tempDir, ".flisk", "project.json"), "{}");
    process.chdir(tempDir);
    getContainerRuntimeStatusMock.mockReturnValue("running");
    isTiltAvailableMock.mockResolvedValue(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await downCommand.parseAsync(["node", "flisk", "--dry-run"], { from: "node" });

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Dry run - not stopping resources");
      expect(output).toContain("Would run: tilt down");
      expect(buildTiltDownArgs).not.toHaveBeenCalled();
      expect(runTiltMock).not.toHaveBeenCalled();
      expect(getContainerRuntimeStatusMock).toHaveBeenCalledTimes(1);
      expect(isTiltAvailableMock).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
      log.mockRestore();
    }
  });

  it("accepts --force as a deprecated alias for --yes without forwarding force to buildTiltDownArgs", async () => {
    const { warn, cleanup } = setupDownAliasTest("flisk-down-force-test-");

    try {
      await downCommand.parseAsync(["node", "flisk", "--force"], { from: "node" });

      expectDeprecatedAliasBehavior(warn);
    } finally {
      cleanup();
    }
  });

  it("accepts -f as a deprecated alias for -y/--yes with deprecation notice", async () => {
    const { warn, cleanup } = setupDownAliasTest("flisk-down-force-short-test-");

    try {
      await downCommand.parseAsync(["node", "flisk", "-f"], { from: "node" });

      expectDeprecatedAliasBehavior(warn);
    } finally {
      cleanup();
    }
  });

  it("accepts -y and --yes without printing the --force deprecation notice", async () => {
    const { warn, cleanup } = setupDownAliasTest("flisk-down-yes-test-");

    try {
      await downCommand.parseAsync(["node", "flisk", "-y"], { from: "node" });

      expect(downCommand.opts().yes).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expectDownTiltInvocation();

      downCommand.setOptionValue("yes", false);
      warn.mockClear();

      await downCommand.parseAsync(["node", "flisk", "--yes"], { from: "node" });

      expect(downCommand.opts().yes).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      expectDownTiltInvocation();
    } finally {
      cleanup();
    }
  });
});
