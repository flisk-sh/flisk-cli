// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));

import fs from "node:fs";
import path from "node:path";
import { captureExit, createTempDir, fakeSpawn } from "../../../test-support/index.js";
import {
  checkImportDirArg,
  executeImport,
  importFailure,
  importReport,
  nonInteractiveRefusal,
  runImport,
  runImportCaptured,
} from "../run.js";

const IMPORTER_OUTPUT = [
  "Plan for ./legacy (stack legacy):",
  "  api   create  services/legacy/api/service.json",
  "  wrote services/legacy/api/service.json",
  "",
  "Wrote 1 service.json file(s).",
  "",
].join("\n");

describe("import run contract", () => {
  it("runs the importer with piped output and resolves to what it printed", async () => {
    const { calls, spawnFn } = fakeSpawn({ code: 0, stdout: "out", stderr: "err" });
    const run = await runImportCaptured([".", "--yes"], spawnFn, () => "1.4.10");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("out");
    expect(run.stderr).toBe("err");
    const stdio = (calls[0]?.[2] as { stdio: unknown } | undefined)?.stdio;
    expect(stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("reports the core version gate as a run, without spawning", async () => {
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    const refused = await runImportCaptured([".", "--yes"], spawnFn, () => "1.3.100");
    expect(refused).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "flisk import: installed Flisk core (1.3.100) is older than the required 1.3.104 (buildContext release). Upgrade with: flisk upgrade",
    });
    expect(calls).toHaveLength(0);
  });

  it("exits 1 without spawning on the terminal path too", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    expect(await runImport([".", "--yes"], spawnFn, () => "1.3.100")).toBe(1);
    expect(calls).toHaveLength(0);
    err.mockRestore();
  });

  it("reads the report of a successful run from the importer's 'wrote' lines", () => {
    expect(
      importReport(["./legacy", "--yes"], {
        exitCode: 0,
        stdout: IMPORTER_OUTPUT,
        stderr: "",
      }),
    ).toEqual({
      dir: "./legacy",
      dryRun: false,
      force: false,
      written: ["services/legacy/api/service.json"],
      services: [],
      skipped: [],
      planned: [],
      output: IMPORTER_OUTPUT.trim(),
    });
  });

  it("shapes a dry run report with nothing written", () => {
    expect(
      importReport(["--dry-run", "--yes"], {
        exitCode: 0,
        stdout: "Dry run: nothing written.",
        stderr: "",
      }),
    ).toEqual({
      dir: ".",
      dryRun: true,
      force: false,
      written: [],
      services: [],
      skipped: [],
      planned: [],
      output: "Dry run: nothing written.",
    });
  });

  it("turns a failed run into IMPORT_FAILED with the importer's message and hints", () => {
    const error = importFailure(
      {
        exitCode: 2,
        stdout: "",
        stderr: "Error: compose.yml is not valid YAML\n  -> Fix line 3\n",
      },
      "flisk import",
    );
    expect(error).toMatchObject({
      code: "IMPORT_FAILED",
      message: "compose.yml is not valid YAML",
      suggestions: ["Fix line 3"],
      exitCode: 2,
    });
  });
});

describe("checkImportDirArg", () => {
  const asDir = () => ({ isDirectory: () => true });
  const asFile = () => ({ isDirectory: () => false });

  it.each(["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"])(
    "rewrites a Compose file argument to its parent directory (%s)",
    (name) => {
      expect(
        checkImportDirArg([`./stack/${name}`], "flisk import", (path) =>
          path === `./stack/${name}` ? asFile() : undefined,
        ),
      ).toEqual({ status: "rewrite", index: 0, dir: "./stack" });
      expect(checkImportDirArg([name], "flisk import", () => asFile())).toEqual({
        status: "rewrite",
        index: 0,
        dir: ".",
      });
    },
  );

  it("says a missing path does not exist and hints at the directory to pass", () => {
    expect(checkImportDirArg(["./nope.yml"], "flisk import", () => undefined)).toEqual({
      status: "error",
      message: "./nope.yml does not exist",
      suggestion:
        "Run `flisk import` in the directory that holds docker-compose.yml (or compose.yaml)",
    });
  });

  it("refuses a file that is not a Compose file and names its directory", () => {
    expect(checkImportDirArg(["./docs/README.md"], "flisk import", () => asFile())).toEqual({
      status: "error",
      message: "./docs/README.md is a file, not a directory",
      suggestion: "Pass the directory that holds it: flisk import ./docs",
    });
    expect(
      checkImportDirArg(["./stack/custom.yml"], "flisk import compose", () => asFile()),
    ).toEqual({
      status: "error",
      message: "./stack/custom.yml is a file, not a directory",
      suggestion: "Pass the directory that holds it: flisk import compose ./stack",
    });
  });

  it("accepts an existing directory and skips the check for the tiltfile path", () => {
    const statFn = vi.fn(() => asDir());
    expect(checkImportDirArg(["./stack"], "flisk import", statFn)).toEqual({ status: "ok" });
    expect(statFn).toHaveBeenCalledWith("./stack");
    statFn.mockClear();
    expect(checkImportDirArg(["tiltfile", "./Tiltfile"], "flisk import tiltfile", statFn)).toEqual({
      status: "ok",
    });
    expect(statFn).not.toHaveBeenCalled();
  });

  it("checks the positional after the compose keyword and after flags", () => {
    const statFn = vi.fn(() => undefined);
    expect(checkImportDirArg(["compose", "--dry-run", "./gone"], "flisk import", statFn)).toEqual({
      status: "error",
      message: "./gone does not exist",
      suggestion:
        "Run `flisk import` in the directory that holds docker-compose.yml (or compose.yaml)",
    });
    expect(statFn).toHaveBeenCalledWith("./gone");
  });

  it("stays out of the way without a positional or when the stat itself fails", () => {
    const statFn = vi.fn(() => undefined);
    expect(checkImportDirArg([], "flisk import", statFn)).toEqual({ status: "ok" });
    expect(checkImportDirArg(["--dry-run", "--yes"], "flisk import", statFn)).toEqual({
      status: "ok",
    });
    expect(checkImportDirArg(["compose"], "flisk import compose", statFn)).toEqual({
      status: "ok",
    });
    expect(statFn).not.toHaveBeenCalled();
    const throwing = () => {
      throw new Error("EACCES");
    };
    expect(checkImportDirArg(["./locked"], "flisk import", throwing)).toEqual({ status: "ok" });
  });
});

describe("non-interactive refusal", () => {
  it("refuses a write with the exact refusal text", () => {
    expect(nonInteractiveRefusal(["."], "flisk import", false)).toBe(
      [
        "flisk import: no terminal to confirm the import, so nothing was written.",
        "-> Preview first: flisk import --dry-run",
        "-> Then write without a prompt: flisk import --yes (or --json)",
      ].join("\n"),
    );
  });

  it("names the subcommand that was refused", () => {
    expect(nonInteractiveRefusal(["."], "flisk import compose", false)).toContain(
      "flisk import compose: no terminal to confirm the import",
    );
  });
});

describe("executeImport --json envelope", () => {
  it("carries the importer's plan as structured fields in data", async () => {
    const plan = [
      "Found 1 service(s) and 0 job(s) in /tmp/legacy",
      "",
      "  web  (service)",
      "    image:     nginx:alpine",
      "    port:      80 (from Compose)",
      "    proxy:     routed through Traefik",
      "    write:     services/legacy/web/service.json  [create]",
      "",
      "Skipped / not fully imported:",
      "  docker-compose.yml [compose]: restart not set for web: Flisk restarts it (unless-stopped)",
      "",
      "Dry run: nothing written.",
    ].join("\n");
    const { spawnFn } = fakeSpawn({ code: 0, stdout: plan });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    try {
      const legacy = path.join(createTempDir(), "legacy");
      fs.mkdirSync(legacy);
      await executeImport([legacy], { json: true, dryRun: true });
      const envelope = JSON.parse(write.mock.calls.map((call) => String(call[0])).join(""));
      expect(envelope.data).toMatchObject({
        dir: legacy,
        dryRun: true,
        written: [],
        services: [
          {
            name: "web",
            kind: "service",
            image: "nginx:alpine",
            port: 80,
            proxy: "traefik",
            dependsOn: [],
            write: { path: "services/legacy/web/service.json", action: "create" },
            notes: [],
          },
        ],
        skipped: [
          {
            source: "docker-compose.yml",
            detector: "compose",
            reason: "restart not set for web: Flisk restarts it (unless-stopped)",
          },
        ],
        planned: ["services/legacy/web/service.json"],
      });
    } finally {
      write.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("prints the dry-run report as one byte-identical envelope on stdout", async () => {
    const { spawnFn } = fakeSpawn({ code: 0, stdout: "Dry run: nothing written." });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const cwd = process.cwd();
    const tmp = createTempDir();
    fs.mkdirSync(path.join(tmp, "legacy"));
    process.chdir(tmp);
    try {
      await executeImport(["./legacy"], { json: true, dryRun: true });
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      expect(stdout).toBe(
        `${JSON.stringify({
          schemaVersion: 1,
          data: {
            dir: "./legacy",
            dryRun: true,
            force: false,
            written: [],
            services: [],
            skipped: [],
            planned: [],
            output: "Dry run: nothing written.",
          },
          errors: [],
        })}\n`,
      );
    } finally {
      write.mockRestore();
      process.chdir(cwd);
      mocks.spawn.mockReset();
    }
  });

  it("prints a byte-identical IMPORT_FAILED envelope when the importer fails", async () => {
    const { spawnFn } = fakeSpawn({
      code: 2,
      stderr: "Error: compose.yml is not valid YAML\n  -> Fix line 3\n",
    });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = captureExit();
    const cwd = process.cwd();
    const tmp = createTempDir();
    fs.mkdirSync(path.join(tmp, "legacy"));
    process.chdir(tmp);
    try {
      await expect(executeImport(["./legacy"], { json: true })).rejects.toThrow("process.exit");
      exit.expectExit(2);
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      expect(stdout).toBe(
        `${JSON.stringify({
          schemaVersion: 1,
          data: null,
          errors: [
            {
              code: "IMPORT_FAILED",
              message: "compose.yml is not valid YAML",
              suggestions: ["Fix line 3"],
            },
          ],
        })}\n`,
      );
    } finally {
      write.mockRestore();
      err.mockRestore();
      exit.exit.mockRestore();
      process.chdir(cwd);
      mocks.spawn.mockReset();
    }
  });

  it("imports the parent directory when the argument is a Compose file", async () => {
    const dir = createTempDir();
    const composeFile = path.join(dir, "docker-compose.yml");
    fs.writeFileSync(composeFile, "services: {}\n");
    const { calls, spawnFn } = fakeSpawn({ code: 0, stdout: "Dry run: nothing written." });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeImport([composeFile], { json: true, dryRun: true });
      const forwarded = calls[0]?.[1] as string[];
      expect(forwarded.slice(-3)).toEqual([dir, "--dry-run", "--yes"]);
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      expect(JSON.parse(stdout)).toEqual({
        schemaVersion: 1,
        data: {
          dir,
          dryRun: true,
          force: false,
          written: [],
          output: "Dry run: nothing written.",
          planned: [],
          services: [],
          skipped: [],
        },
        errors: [],
      });
      expect(err).toHaveBeenCalledWith(
        `-> ${composeFile} is a Compose file; importing its directory ${dir}`,
      );
    } finally {
      write.mockRestore();
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("prints an IMPORT_FAILED envelope for a path that does not exist, without spawning", async () => {
    const missing = path.join(createTempDir(), "nope.yml");
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = captureExit();
    try {
      await expect(executeImport([missing], { json: true })).rejects.toThrow("process.exit");
      exit.expectExit(1);
      expect(calls).toHaveLength(0);
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      expect(JSON.parse(stdout)).toEqual({
        schemaVersion: 1,
        data: null,
        errors: [
          {
            code: "IMPORT_FAILED",
            message: `${missing} does not exist`,
            suggestions: [
              "Run `flisk import` in the directory that holds docker-compose.yml (or compose.yaml)",
            ],
          },
        ],
      });
    } finally {
      write.mockRestore();
      err.mockRestore();
      exit.exit.mockRestore();
      mocks.spawn.mockReset();
    }
  });
});

describe("executeImport path errors on a terminal", () => {
  it("prints the error and its hint and never spawns the importer", async () => {
    const missing = path.join(createTempDir(), "nope.yml");
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevExitCode = process.exitCode;
    try {
      await executeImport([missing], { dryRun: true });
      expect(process.exitCode).toBe(1);
      expect(calls).toHaveLength(0);
      expect(err).toHaveBeenCalledWith(
        `Error: ${missing} does not exist\n` +
          "  -> Run `flisk import` in the directory that holds docker-compose.yml (or compose.yaml)",
      );
    } finally {
      err.mockRestore();
      mocks.spawn.mockReset();
      process.exitCode = prevExitCode;
    }
  });

  it("runs the importer on the parent directory of a Compose file argument", async () => {
    const dir = createTempDir();
    const composeFile = path.join(dir, "compose.yaml");
    fs.writeFileSync(composeFile, "services: {}\n");
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevExitCode = process.exitCode;
    try {
      await executeImport([composeFile, "--dry-run"], {});
      expect(calls).toHaveLength(1);
      const forwarded = calls[0]?.[1] as string[];
      expect(forwarded.slice(-2)).toEqual([dir, "--dry-run"]);
      expect(err).toHaveBeenCalledWith(
        `-> ${composeFile} is a Compose file; importing its directory ${dir}`,
      );
    } finally {
      err.mockRestore();
      mocks.spawn.mockReset();
      process.exitCode = prevExitCode;
    }
  });

  it("refuses a non-Compose file with the directory to pass instead", async () => {
    const dir = createTempDir();
    const file = path.join(dir, "notes.txt");
    fs.writeFileSync(file, "hi\n");
    const { calls, spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevExitCode = process.exitCode;
    try {
      await executeImport([file, "--dry-run"], {});
      expect(process.exitCode).toBe(1);
      expect(calls).toHaveLength(0);
      expect(err).toHaveBeenCalledWith(
        `Error: ${file} is a file, not a directory\n` +
          `  -> Pass the directory that holds it: flisk import ${dir}`,
      );
    } finally {
      err.mockRestore();
      mocks.spawn.mockReset();
      process.exitCode = prevExitCode;
    }
  });
});
