// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

/** Runs a check with a PATH that contains only the named fake programs (#3744). */
export async function withSimulatedPath<T>(
  programs: string[],
  fn: () => T | Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-runner-path-"));
  for (const program of programs) fs.writeFileSync(path.join(dir, program), "");
  const original = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Invocation = {
  command: string;
  args: string[];
  shell: boolean;
  windowsVerbatimArguments: boolean;
  pkg: string;
};

type InvocationBuilder = (
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  opts?: { execPath?: string; comSpec?: string },
) => Invocation;

/** Registers the npx/bunx runner-selection cases shared by `flisk import` and `flisk export`. */
export function itSelectsPackageRunner(build: InvocationBuilder, pkg: string): void {
  const windows = { execPath: "C:\\tools\\flisk.exe", comSpec: "cmd.exe" };

  it("uses npx when it is on PATH, even when bunx is too", async () => {
    await withSimulatedPath(["npx", "bunx"], () => {
      const inv = build(["."], {}, "linux");
      expect(inv.command).toBe("npx");
      expect(inv.args.slice(0, 2)).toEqual(["--yes", pkg]);
    });
  });

  it("uses bunx without --yes when only bunx is on PATH (#3744)", async () => {
    await withSimulatedPath(["bunx"], () => {
      expect(build([".", "--dry-run"], {}, "linux")).toEqual({
        command: "bunx",
        args: [pkg, ".", "--dry-run"],
        shell: false,
        windowsVerbatimArguments: false,
        pkg,
      });
    });
  });

  it("uses a resolved bunx.cmd through cmd.exe on Windows when npx is absent (#3744)", async () => {
    await withSimulatedPath(["bunx.cmd"], () => {
      const inv = build(["a&b"], {}, "win32", windows);
      expect(inv.command).toBe("cmd.exe");
      expect(inv.shell).toBe(false);
      expect(inv.windowsVerbatimArguments).toBe(true);
      expect(inv.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(inv.args[3]).toContain("bunx.cmd");
      expect(inv.args[3]).toContain("a^^^&b");
    });
  });

  it("runs the resolved bunx.exe directly on Windows (#3744)", async () => {
    await withSimulatedPath(["bunx.exe"], () => {
      const inv = build(["a&b"], {}, "win32", windows);
      expect(inv.command).toContain("bunx.exe");
      expect(inv.command).not.toBe("cmd.exe");
      expect(inv.shell).toBe(false);
      expect(inv.windowsVerbatimArguments).toBe(false);
      expect(inv.args).toEqual([pkg, "a&b"]);
    });
  });

  it("keeps npx as the fallback when no runner is on PATH", async () => {
    await withSimulatedPath([], () => {
      const inv = build(["."], {}, "linux");
      expect(inv.command).toBe("npx");
      expect(inv.args[0]).toBe("--yes");
    });
  });
}
