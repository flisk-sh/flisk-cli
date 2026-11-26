// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import {
  findProjectTiltUpPids,
  lookupProjectTiltUpPids,
  stopProjectTiltUp,
  waitForTiltUpExit,
} from "../down-tilt.js";

const TILTFILE = "/work/shop/.flisk/.flisk-out/Tiltfile";
const WINDOWS_TILTFILE = "C:\\work\\shop\\.flisk\\.flisk-out\\Tiltfile";

/** The `pid<TAB>commandLine` output of the win32 process lookup (PowerShell, Get-CimInstance Win32_Process). */
const WINDOWS_TILT_PROCESSES = [
  `1234\t"C:\\Program Files\\Tilt\\tilt.exe" up -f "${WINDOWS_TILTFILE}" -- --focus=app`,
  `1235\tC:\\tools\\tilt.exe up -f "C:\\work\\my blog\\.flisk\\.flisk-out\\Tiltfile"`,
  `1236\tC:\\tools\\tilt.exe up -f ${WINDOWS_TILTFILE}`,
  `1237\tC:\\tools\\tilt.exe down -f ${WINDOWS_TILTFILE}`,
  `1238\tC:\\tools\\tilt.exe up -f C:\\work\\other\\Tiltfile`,
  `1239\tC:\\tools\\tilt.exe up -f C:\\work\\copy\\.flisk\\.flisk-out\\Tiltfile.backup`,
  `1240\tC:\\tools\\vim.exe up -f ${WINDOWS_TILTFILE}`,
  `1241\tC:\\tools\\tilt.exe up -f C:\\work\\deleted\\.flisk\\.flisk-out\\Tiltfile`,
  "invalid line without command",
].join("\r\n");

const windowsProcessRunner = vi.fn((command: string, _args: string[]) =>
  command === "powershell.exe" ? WINDOWS_TILT_PROCESSES : "",
);

describe("findProjectTiltUpPids and stopProjectTiltUp", () => {
  const ps = [
    `  100 /opt/homebrew/bin/tilt up -f ${TILTFILE} -- --focus=shop`,
    `  101 /opt/homebrew/bin/tilt up -f /work/other/.flisk/.flisk-out/Tiltfile`,
    `  102 /opt/homebrew/bin/tilt down -f ${TILTFILE}`,
    `  103 /opt/homebrew/bin/tilt up -f ${TILTFILE}-copy`,
    `  104 vim ${TILTFILE}`,
    `  105 tilt up -f ${TILTFILE}`,
    `  106 /usr/local/bin/tilt up -f ${TILTFILE}`,
    `  107 tilt up -f ${TILTFILE}.backup`,
    "  invalid line without command",
  ].join("\n");

  it("matches only tilt up processes for this project's Tiltfile", () => {
    expect(findProjectTiltUpPids(TILTFILE, "darwin", () => ps)).toEqual([100, 105, 106]);
  });

  it("returns nothing when ps fails", () => {
    expect(
      findProjectTiltUpPids(TILTFILE, "linux", () => {
        throw new Error("no ps");
      }),
    ).toEqual([]);
  });

  it("matches only tilt up processes for this project's Tiltfile on Windows", () => {
    windowsProcessRunner.mockClear();
    expect(findProjectTiltUpPids(WINDOWS_TILTFILE, "win32", windowsProcessRunner)).toEqual([
      1234, 1236,
    ]);
    // A Tiltfile path passed with POSIX separators (e.g. by a caller on WSL) matches too.
    expect(
      findProjectTiltUpPids(
        "C:/work/shop/.flisk/.flisk-out/Tiltfile",
        "win32",
        windowsProcessRunner,
      ),
    ).toEqual([1234, 1236]);
    expect(windowsProcessRunner).toHaveBeenCalledTimes(2);
    const [command, args] = windowsProcessRunner.mock.calls[0] as [string, string[]];
    expect(command).toBe("powershell.exe");
    expect(args.join(" ")).toContain("Get-CimInstance Win32_Process");
  });

  it("lookupProjectTiltUpPids answers null, not none, when the process list fails", () => {
    expect(
      lookupProjectTiltUpPids(TILTFILE, "linux", () => {
        throw new Error("no ps");
      }),
    ).toBeNull();
    expect(
      lookupProjectTiltUpPids(WINDOWS_TILTFILE, "win32", () => {
        throw new Error("spawn powershell.exe ENOENT");
      }),
    ).toBeNull();
    expect(lookupProjectTiltUpPids(TILTFILE, "darwin", () => ps)).toEqual([100, 105, 106]);
  });

  it("stopProjectTiltUp kills each Windows match with taskkill", () => {
    const calls: string[][] = [];
    const runner = (command: string, args: string[]): string => {
      calls.push([command, ...args]);
      return command === "powershell.exe" ? WINDOWS_TILT_PROCESSES : "";
    };
    expect(stopProjectTiltUp(WINDOWS_TILTFILE, "win32", runner)).toEqual([1234, 1236]);
    expect(calls).toEqual([
      ["powershell.exe", "-NoProfile", "-Command", expect.any(String)],
      ["taskkill.exe", "/PID", "1234", "/F"],
      ["taskkill.exe", "/PID", "1236", "/F"],
    ]);
  });

  it("stopProjectTiltUp sends TERM to each match and tolerates dead processes during kill", () => {
    const sent: string[][] = [];
    const runner = (cmd: string, args: string[]) => {
      if (cmd === "ps") return ps;
      if (args[1] === "100") throw new Error("ESRCH: no such process");
      sent.push(args);
      return "";
    };
    expect(stopProjectTiltUp(TILTFILE, "darwin", runner)).toEqual([100, 105, 106]);
    expect(sent).toEqual([
      ["-TERM", "105"],
      ["-TERM", "106"],
    ]);
  });

  it("stopProjectTiltUp does nothing when no matching pids exist", () => {
    const runner = vi.fn(() => "");
    expect(stopProjectTiltUp(TILTFILE, "darwin", runner)).toEqual([]);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("ps", ["-axo", "pid=,command="]);
  });
});

describe("waitForTiltUpExit", () => {
  it("resolves true immediately when no pids exist initially", async () => {
    expect(await waitForTiltUpExit(TILTFILE, 5000, () => [])).toBe(true);
  });

  it("resolves true once the processes are gone and false on timeout", async () => {
    const seq = [[1], [1], []];
    expect(await waitForTiltUpExit(TILTFILE, 5000, () => seq.shift() ?? [])).toBe(true);
    expect(await waitForTiltUpExit(TILTFILE, 300, () => [1])).toBe(false);
  });
});
