// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  captureExit,
  describe,
  documentedExitCode,
  expect,
  it,
  nativeWindowsUpRefusal,
  upCommand,
  vi,
} from "../../test-support/up.js";

describe("flisk up platform contract", () => {
  it("refuses native Windows unless the explicit escape hatch is set", () => {
    const refusal = nativeWindowsUpRefusal("win32");
    expect(refusal).toContain(
      "Landscape startup needs Ubuntu on WSL2. Native Windows runs only services that declare a command, as local processes.",
    );
    expect(refusal).toContain("You are on Windows. Open Ubuntu (WSL2)");
    expect(refusal).toContain("wsl --install -d Ubuntu");
    expect(nativeWindowsUpRefusal("win32", "0")).not.toBeNull();
    expect(nativeWindowsUpRefusal("win32", "1")).toBeNull();
    expect(nativeWindowsUpRefusal("linux")).toBeNull();
  });

  it("exits 1 on native Windows startup refusal and writes the diagnostic to stderr", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const allowNativeWindows = process.env.FLISK_ALLOW_NATIVE_WINDOWS;
    const tiltPort = process.env.TILT_PORT;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { exit } = captureExit();
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      delete process.env.FLISK_ALLOW_NATIVE_WINDOWS;
      delete process.env.TILT_PORT;

      await expect(upCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");

      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          "❌ Landscape startup needs Ubuntu on WSL2. Native Windows runs only services that declare a command, as local processes.",
        ),
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      if (allowNativeWindows === undefined) delete process.env.FLISK_ALLOW_NATIVE_WINDOWS;
      else process.env.FLISK_ALLOW_NATIVE_WINDOWS = allowNativeWindows;
      if (tiltPort === undefined) delete process.env.TILT_PORT;
      else process.env.TILT_PORT = tiltPort;
      exit.mockRestore();
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("documents the native Windows startup refusal under the exit code it returns", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const allowNativeWindows = process.env.FLISK_ALLOW_NATIVE_WINDOWS;
    const tiltPort = process.env.TILT_PORT;
    const { exit } = captureExit();
    let actual: number | undefined;
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      delete process.env.FLISK_ALLOW_NATIVE_WINDOWS;
      delete process.env.TILT_PORT;

      await expect(upCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");
      actual = exit.mock.calls[0]?.[0] as number;
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
      if (allowNativeWindows === undefined) delete process.env.FLISK_ALLOW_NATIVE_WINDOWS;
      else process.env.FLISK_ALLOW_NATIVE_WINDOWS = allowNativeWindows;
      if (tiltPort === undefined) delete process.env.TILT_PORT;
      else process.env.TILT_PORT = tiltPort;
      exit.mockRestore();
    }

    const documented = documentedExitCode("native Windows startup refusal");
    expect(documented).toBe(actual);
  });
});
