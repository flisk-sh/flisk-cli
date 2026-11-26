// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { CheckResult } from "./test-support.js";
import {
  afterEach,
  captureExit,
  checkWindowsDockerMode,
  checkWindowsHostConfiguration,
  checkWindowsRuntimeTools,
  describe,
  doctorCommand,
  expect,
  it,
  join,
  mkdtempSync,
  NATIVE_WINDOWS_DOCTOR_MESSAGE,
  rmSync,
  tmpdir,
  vi,
} from "./test-support.js";

describe("doctor native Windows diagnostics", () => {
  afterEach(() => {
    doctorCommand.setOptionValue("json", false);
    doctorCommand.setOptionValue("ping", true);
    vi.mocked(checkWindowsRuntimeTools).mockClear();
    vi.mocked(checkWindowsDockerMode).mockClear();
    vi.mocked(checkWindowsHostConfiguration).mockClear();
  });

  it("prints Windows diagnostics next to the native Windows refusal and exits 1", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      await expect(doctorCommand.parseAsync([], { from: "user" })).rejects.toThrow(/exit/);
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(checkWindowsRuntimeTools).toHaveBeenCalledOnce();
      expect(checkWindowsDockerMode).toHaveBeenCalledOnce();
      expect(checkWindowsHostConfiguration).toHaveBeenCalledOnce();

      const text = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(text).toContain("Windows containers");
      expect(text).toContain("flisk.localhost");
      expect(text).toContain("core.autocrlf");
      expect(text).toContain("Hyper-V");
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("includes Windows diagnostic findings in --json data.checks while staying unready", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();
    // findProjectRoot() walks up from the cwd; a project above it would add a fifth check.
    const originalCwd = process.cwd();
    const outsideProject = mkdtempSync(join(tmpdir(), "flisk-doctor-win-json-"));

    try {
      process.chdir(outsideProject);
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      await expect(doctorCommand.parseAsync(["--json"], { from: "user" })).rejects.toThrow(/exit/);
      expect(exit).toHaveBeenCalledWith(1);

      const raw = String(log.mock.calls.find((call) => String(call[0]).startsWith("{"))?.[0]);
      const report = JSON.parse(raw);
      expect(report.data.ready).toBe(false);
      expect(report.data.checks.map((check: CheckResult) => check.name)).toEqual([
        "Native Windows support",
        "Windows Runtime Tools",
        "Docker container mode",
        "Windows ports and DNS",
      ]);
      expect(report.data.checks[0].message).toBe(NATIVE_WINDOWS_DOCTOR_MESSAGE);
      expect(report.data.checks[2].didPass).toBe(false);
      expect(report.data.checks[3].message).toContain("core.autocrlf");
      expect(report.data.host).toMatchObject({ kind: "native-windows", canUp: false });
    } finally {
      process.chdir(originalCwd);
      rmSync(outsideProject, { recursive: true, force: true });
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });
});
