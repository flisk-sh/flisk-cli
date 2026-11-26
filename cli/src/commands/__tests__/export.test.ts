// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

import { createTempDir, npxArgs, runCommandInProcess } from "../../test-support/index.js";
import { itSelectsPackageRunner } from "../../test-support/runner-selection.js";
import {
  buildForwardedExportArgs,
  EXPORT_PACKAGE,
  exportCommand,
  exportInvocation,
  runExport,
} from "../export.js";

function fakeSpawn(outcome: {
  code?: number | null;
  error?: Error;
  stderr?: string | Buffer | Array<string | Buffer>;
}) {
  const calls: unknown[][] = [];
  const spawnFn = ((command: string, args: string[], options: unknown) => {
    calls.push([command, args, options]);
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    queueMicrotask(() => {
      if (outcome.error) {
        child.emit("error", outcome.error);
        child.emit("close", -2);
        return;
      }
      for (const chunk of [outcome.stderr ?? []].flat()) {
        child.stderr.emit("data", Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      child.emit("close", outcome.code);
    });
    return child;
  }) as never;
  return { calls, spawnFn };
}

describe("flisk export", () => {
  it("runs the exporter from npm at an exact version, not from a git branch", () => {
    expect(EXPORT_PACKAGE).toMatch(/^@flisk-sh\/flisk-export@\d+\.\d+\.\d+$/);
  });

  it("lists the compose exporter (flisk-export 0.5.0) next to render and wrangler", () => {
    expect(exportCommand.description()).toContain("docker-compose.yml");
    const usage = exportCommand.registeredArguments[0]?.description ?? "";
    expect(usage).toContain("render [dir]");
    expect(usage).toContain("wrangler [dir]");
    expect(usage).toContain("compose [dir]");
  });

  it("forwards every argument, including flags, to flisk-export", () => {
    const args = ["wrangler", "--resource", "edge", "--route", "api.example.com", "--force"];
    expect(exportInvocation(args, {}, "linux")).toEqual({
      command: "npx",
      args: ["--yes", EXPORT_PACKAGE, ...args],
      shell: false,
      windowsVerbatimArguments: false,
      pkg: EXPORT_PACKAGE,
    });
  });

  itSelectsPackageRunner(exportInvocation, EXPORT_PACKAGE);

  it("on Windows passes a path with a space and an ampersand to npx without a shell (#4004)", () => {
    const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
    const npxCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
    const args = ["render", "C:\\Users\\Jane Smith\\shop", "--out", "build&out"];
    expect(
      exportInvocation(args, {}, "win32", { execPath: nodeExe, exists: (p) => p === npxCli }),
    ).toEqual({
      command: nodeExe,
      args: [npxCli, "--yes", EXPORT_PACKAGE, ...args],
      shell: false,
      windowsVerbatimArguments: false,
      pkg: EXPORT_PACKAGE,
    });
  });

  it("lets FLISK_EXPORT_PACKAGE override the pinned package", () => {
    const inv = exportInvocation(["render"], { FLISK_EXPORT_PACKAGE: "./local.tgz" }, "linux");
    expect(inv.args).toEqual(["--yes", "./local.tgz", "render"]);
  });

  it("passes --dry-run through once", () => {
    expect(buildForwardedExportArgs(["render"], { dryRun: true })).toEqual(["render", "--dry-run"]);
    expect(buildForwardedExportArgs(["render", "--dry-run"], { dryRun: true })).toEqual([
      "render",
      "--dry-run",
    ]);
    expect(buildForwardedExportArgs(["render"], {})).toEqual(["render"]);
  });

  it("runs the command through npx with the terminal and its arguments", async () => {
    const dir = createTempDir();
    mocks.spawn.mockImplementation(fakeSpawn({ code: 0 }).spawnFn);
    const result = await runCommandInProcess(
      exportCommand,
      ["render", "--resource", "api", "--dry-run"],
      dir,
    );
    expect(result.status ?? 0).toBe(0);
    const [command, args, options] = mocks.spawn.mock.calls.at(-1) as [
      string,
      string[],
      { stdio: unknown },
    ];
    expect(command).toMatch(/npx|node/i);
    expect(npxArgs(args).slice(0, 2)).toEqual(["--yes", EXPORT_PACKAGE]);
    expect(args).toEqual(expect.arrayContaining(["render", "--resource", "api", "--dry-run"]));
    expect(args.filter((arg) => arg === "--dry-run")).toHaveLength(1);
    expect(options.stdio).toEqual(["inherit", "inherit", "pipe"]);
  });

  it("resolves to the exporter's exit code", async () => {
    const ok = fakeSpawn({ code: 0 });
    expect(await runExport(["render"], ok.spawnFn, {})).toBe(0);
    expect(npxArgs(ok.calls[0][1] as string[])).toEqual(["--yes", EXPORT_PACKAGE, "render"]);
  });

  it("says the package may be unavailable when the exporter exits non-zero", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failed = fakeSpawn({ code: 1 });
      expect(await runExport(["render"], failed.spawnFn, {})).toBe(1);
      const printed = error.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain(`${EXPORT_PACKAGE} exited with code 1`);
      expect(printed).toContain("could not download it");
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    {
      name: "exporter input errors, including a split UTF-8 character",
      chunks: (() => {
        const diagnostic = Buffer.from("Error: Invalid café input\n");
        const accent = diagnostic.indexOf(Buffer.from("é"));
        return [
          diagnostic.subarray(0, 2),
          diagnostic.subarray(2, accent + 1),
          diagnostic.subarray(accent + 1),
        ];
      })(),
      showsNetworkHint: false,
    },
    {
      name: "network errors",
      chunks: ["Error: getaddrinfo ENOTFOUND registry.npmjs.org\n"],
      showsNetworkHint: true,
    },
    {
      name: "npm-style errors without an Error line",
      chunks: ["npm ERR! code E404\n"],
      showsNetworkHint: true,
    },
  ])(
    "classifies $name while forwarding stderr chunks unchanged",
    async ({ chunks, showsNetworkHint }) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const failed = fakeSpawn({ code: 1, stderr: chunks });
        expect(await runExport(["render"], failed.spawnFn, {})).toBe(1);
        const printed = error.mock.calls.map((call) => String(call[0])).join("\n");
        expect(printed.includes("could not download it")).toBe(showsNetworkHint);
        expect(stderr.mock.calls.map(([chunk]) => chunk)).toEqual(
          chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
        );
      } finally {
        error.mockRestore();
        stderr.mockRestore();
      }
    },
  );

  it("exits 127 with an install hint when npx cannot be run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const missing = fakeSpawn({ error: new Error("spawn npx ENOENT") });
      expect(await runExport(["render"], missing.spawnFn, {})).toBe(127);
      expect(String(error.mock.calls[0][0])).toContain(
        "could not run npx or bunx (spawn npx ENOENT). Install Node.js (npx) or Bun (bunx)",
      );
      // A failed spawn still emits close afterwards; that must not print the unavailable hint too.
      expect(error.mock.calls).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });
});
