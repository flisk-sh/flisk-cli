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

import { createTempProject, fakeSpawn } from "../../../test-support/index.js";
import { executeImport } from "../run.js";
import {
  findSkippedProcfiles,
  importTargetDir,
  skippedImportSources,
  skippedSourcesNotice,
} from "../skipped-sources.js";

const COMPOSE = "services:\n  db:\n    image: postgres:16\n";
const PROCFILE = "web: node server.js\nworker: node worker.js\nrelease: node migrate.js\n";

function composeAndProcfile(files: Record<string, string> = {}): string {
  return createTempProject({
    projectJson: null,
    files: { "docker-compose.yml": COMPOSE, Procfile: PROCFILE, ...files },
  });
}

describe("importTargetDir", () => {
  it("returns null for a tiltfile import, which never scans a Compose file", () => {
    expect(importTargetDir(["tiltfile", "./deploy", "--yes"])).toBeNull();
  });

  it("returns the first positional argument or the current directory", () => {
    expect(importTargetDir(["./legacy", "--yes"])).toBe("./legacy");
    expect(importTargetDir(["--dry-run", "--yes"])).toBe(".");
  });
});

describe("findSkippedProcfiles", () => {
  it("lists a Procfile next to the root Compose file with its process names", () => {
    const dir = composeAndProcfile();
    expect(findSkippedProcfiles(dir)).toEqual([
      { file: "Procfile", processes: ["web", "worker", "release"] },
    ]);
  });

  it("matches every compose file name the importer reads and every Procfile.* sibling", () => {
    for (const compose of [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
    ]) {
      const dir = createTempProject({
        projectJson: null,
        files: { [compose]: COMPOSE, "Procfile.dev": "web: node dev.js\n" },
      });
      expect(findSkippedProcfiles(dir)).toEqual([{ file: "Procfile.dev", processes: ["web"] }]);
    }
  });

  it("sorts several Procfiles by name", () => {
    const dir = composeAndProcfile({ "Procfile.dev": "web: node dev.js\n" });
    expect(findSkippedProcfiles(dir).map((source) => source.file)).toEqual([
      "Procfile",
      "Procfile.dev",
    ]);
  });

  it("skips comments, blank lines and lines without a process name", () => {
    const dir = composeAndProcfile({
      Procfile: "# a comment\n\nweb: node server.js\nno-colon-here\n: orphan\n",
    });
    expect(findSkippedProcfiles(dir)).toEqual([{ file: "Procfile", processes: ["web"] }]);
  });

  it("returns nothing without a root Compose file, in a missing directory, or when Procfile is a directory", () => {
    const procfileOnly = createTempProject({ projectJson: null, files: { Procfile: PROCFILE } });
    expect(findSkippedProcfiles(procfileOnly)).toEqual([]);

    const composeOnly = createTempProject({
      projectJson: null,
      files: { "docker-compose.yml": COMPOSE },
    });
    expect(findSkippedProcfiles(composeOnly)).toEqual([]);

    expect(findSkippedProcfiles("/path/that/does/not/exist")).toEqual([]);

    const procfileDir = createTempProject({
      projectJson: null,
      files: { "docker-compose.yml": COMPOSE, "Procfile/.keep": "" },
    });
    expect(findSkippedProcfiles(procfileDir)).toEqual([]);
  });

  it("reports a Procfile with no readable processes by name alone", () => {
    const dir = composeAndProcfile({ Procfile: "# a comment\n\n" });
    expect(findSkippedProcfiles(dir)).toEqual([{ file: "Procfile", processes: [] }]);
  });

  it("returns nothing for a tiltfile import even when a Procfile is present", () => {
    expect(skippedImportSources(["tiltfile", "--dry-run"])).toEqual([]);
  });
});

describe("skippedSourcesNotice", () => {
  it("names each skipped file, its processes and the bring-your-own remedy", () => {
    expect(
      skippedSourcesNotice([{ file: "Procfile", processes: ["web", "worker", "release"] }]),
    ).toBe(
      [
        "Skipped / not fully imported:",
        "  Procfile (web, worker, release): not imported; flisk import reads only the root Compose file",
        "  -> Add each process with `flisk resource <name> --type bring-your-own` (or the flisk-import-procfile skill)",
      ].join("\n"),
    );
  });

  it("lists a file with no readable processes by name alone", () => {
    expect(skippedSourcesNotice([{ file: "Procfile", processes: [] }])).toContain(
      "  Procfile: not imported; flisk import reads only the root Compose file",
    );
  });
});

describe("executeImport skipped Procfile report", () => {
  it("prints the skipped notice on stderr after a terminal import in a Compose + Procfile directory", async () => {
    const { spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeImport([composeAndProcfile()], { dryRun: true });
      expect(err).toHaveBeenCalledWith(
        [
          "Skipped / not fully imported:",
          "  Procfile (web, worker, release): not imported; flisk import reads only the root Compose file",
          "  -> Add each process with `flisk resource <name> --type bring-your-own` (or the flisk-import-procfile skill)",
        ].join("\n"),
      );
    } finally {
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("prints nothing when the import directory has no sibling Procfile", async () => {
    const { spawnFn } = fakeSpawn({ code: 0 });
    mocks.spawn.mockImplementation(spawnFn);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const dir = createTempProject({
        projectJson: null,
        files: { "docker-compose.yml": COMPOSE },
      });
      await executeImport([dir], { dryRun: true });
      expect(err).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("carries the skipped sources in the --json envelope and keeps stderr empty", async () => {
    const { spawnFn } = fakeSpawn({ code: 0, stdout: "Dry run: nothing written." });
    mocks.spawn.mockImplementation(spawnFn);
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await executeImport([composeAndProcfile()], { json: true, dryRun: true });
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      const envelope = JSON.parse(stdout) as {
        data: { skipped: unknown[] };
      };
      expect(envelope.data.skipped).toEqual([
        {
          source: "Procfile",
          detector: "procfile",
          reason: "not imported; flisk import reads only the root Compose file",
          processes: ["web", "worker", "release"],
        },
      ]);
      // Under --json the human report stays out of stderr; the skip is in `data.skipped` alone.
      expect(err).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });
});
