// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failingInstall = vi.hoisted(() => ({ command: "", output: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  return {
    ...actual,
    spawnSync: ((command: string, args: readonly string[] | unknown, options: unknown) => {
      const words = Array.isArray(args) ? args.map(String) : [];
      if (
        failingInstall.command !== "" &&
        (command === failingInstall.command || words.includes(failingInstall.command))
      ) {
        return { status: 1, stdout: "", stderr: failingInstall.output };
      }
      // The generator steps are not under test: leave behind the service file create reads back.
      if (words.includes("resource")) {
        const cwd = String((options as { cwd?: string } | undefined)?.cwd ?? "");
        mkdirSync(joinPath(cwd, "api"), { recursive: true });
        writeFileSync(
          joinPath(cwd, "api", "service.json"),
          JSON.stringify({ command: "uvicorn main:app", port: 4000 }),
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    }) as typeof actual.spawnSync,
  };
});

vi.mock("../../utils/which.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/which.js")>()),
  findOnPath: () => "/fake/uvicorn",
}));

import { runCommandInProcess } from "../../test-support/run-in-process.js";
import { commandFailureTail, createCommand, installFailureSuggestions } from "../create.js";

const fliskBin = fileURLToPath(new URL("../../../bin/flisk.js", import.meta.url));
let projectRoot = "";
let argv1Before: string | undefined;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "flisk-create-install-failure-"));
  argv1Before = process.argv[1];
  // cliInvocation() reads process.argv[1]; point the generated steps at a real CLI script.
  process.argv[1] = fliskBin;
});

afterEach(() => {
  if (argv1Before === undefined) delete process.argv[1];
  else process.argv[1] = argv1Before;
  failingInstall.command = "";
  failingInstall.output = "";
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("install failure messages", () => {
  it("keeps only the last ten lines of a command's output", () => {
    const output = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
    expect(commandFailureTail(output)).toBe(
      Array.from({ length: 10 }, (_, index) => `line ${index + 3}`).join("\n"),
    );
  });

  it("points at the Python version when pip reports a mismatch", () => {
    const suggestions = installFailureSuggestions(
      "pip install -e .[dev]",
      "ERROR: Package 'cpy-api' requires a different Python: 3.11.15 not in '>=3.12'",
      "cpy",
      "api",
    );
    expect(suggestions.join("\n")).toContain("Python 3.12");
    expect(suggestions.join("\n")).toContain("api/pyproject.toml");
  });

  it("does not promise a retry for unrelated install failures", () => {
    const suggestions = installFailureSuggestions(
      "cargo build",
      "error: could not compile `api`",
      "cpy",
      "api",
    );
    expect(suggestions.join("\n")).not.toContain("only the install needs a retry");
  });
});

async function runCreate(language = "python") {
  const run = await runCommandInProcess(
    createCommand,
    ["cpy", "--language", language, "--frontend", "none", "--yes", "--start"],
    projectRoot,
  );
  return `${run.stdout}\n${run.stderr}`;
}

describe("flisk create --start when an install fails", () => {
  it("shows pip's real reason and gives Python-version advice instead of a blind retry", async () => {
    failingInstall.command = "pip";
    failingInstall.output = [
      "Collecting cpy-api",
      "  Using cached setuptools-68.0.0-py3-none-any.whl",
      "ERROR: Package 'cpy-api' requires a different Python: 3.11.15 not in '>=3.12'",
    ].join("\n");

    const text = await runCreate();

    expect(text).toContain(
      "ERROR: Package 'cpy-api' requires a different Python: 3.11.15 not in '>=3.12'",
    );
    expect(text).toContain("Python 3.12");
    expect(text).not.toContain("only the install needs a retry");
  });

  it("shows the tail of another language's install error too", async () => {
    failingInstall.command = "cargo";
    failingInstall.output = [
      "   Compiling api v0.1.0",
      'error: could not compile `api` (bin "api") due to 1 previous error',
    ].join("\n");

    const text = await runCreate("rust");

    expect(text).toContain("error: could not compile `api`");
  });
});
