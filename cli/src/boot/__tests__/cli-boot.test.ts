// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureConsole,
  importCli,
  restoreArgv,
  throwOnExit,
} from "../../test-support/cli-exit.js";

const preflight = vi.hoisted(() => ({
  runColdPreflight: vi.fn(async () => ({ ok: true })),
  formatColdPreflight: vi.fn(() => "machine checks"),
  lazy: vi.fn(async () => {}),
}));

// The smoke run stubs argv and captures exits, so the phases that probe the machine or run a
// real command are replaced; everything between them is the real boot path.
vi.mock("../../utils/cold-preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/cold-preflight.js")>()),
  runColdPreflight: preflight.runColdPreflight,
  formatColdPreflight: preflight.formatColdPreflight,
}));

vi.mock("../../commands/lazy-command.js", () => ({
  runLazyCommand: preflight.lazy,
}));

vi.mock("../../utils/env-compat-init.js", () => ({}));
vi.mock("../../utils/engine-env-init.js", () => ({}));

afterEach(() => {
  restoreArgv();
  vi.restoreAllMocks();
  preflight.runColdPreflight.mockResolvedValue({ ok: true });
  preflight.lazy.mockClear();
});

describe("cli.ts boot", () => {
  it("runs the first-run migration for a bare invocation and exits once", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = throwOnExit();

    expect(await importCli()).toBe(0);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("prints the command table for --help and exits 0", async () => {
    const lines = captureConsole();
    throwOnExit();

    expect(await importCli("--help")).toBe(0);
    expect(lines.join("\n")).toContain("Usage: flisk [command] [options]");
  });

  it("answers `help demo` with the demo help", async () => {
    const lines = captureConsole();
    throwOnExit();

    expect(await importCli("help", "demo")).toBe(0);
  });

  it("refuses an unknown root option for the demo flow before any setup (#4487)", async () => {
    const errors = captureConsole("error");
    throwOnExit();

    expect(await importCli("demo", "--dry-run")).toBe(1);
    expect(errors.join("\n")).toContain("error: unknown option '--dry-run'");
  });

  it("reaches parseAsync for a real command and forwards the rewritten argv", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    throwOnExit();

    expect(await importCli("--doctor")).toBeUndefined();
    // parseAsync is deliberately not awaited in the tail, so the action lands after the import.
    await vi.waitFor(() => {
      expect(preflight.lazy).toHaveBeenCalledWith(expect.objectContaining({ name: "doctor" }), [
        "doctor",
      ]);
    });
  });

  it("keeps a single exit point: one process.exit in cli.ts and none in the boot phases", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cliSource = readFileSync(join(here, "..", "..", "cli.ts"), "utf8");
    expect(cliSource.match(/process\.exit\(/g)).toHaveLength(1);
    for (const file of readdirSync(join(here, ".."))) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(here, "..", file), "utf8");
      expect(source.match(/process\.exit\(/g) ?? []).toHaveLength(0);
    }
  });
});
