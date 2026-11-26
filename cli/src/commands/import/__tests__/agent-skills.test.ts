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
import { createTempDir, fakeSpawn, type SpawnOutcome } from "../../../test-support/index.js";
import { TILTFILE_IMPORTER } from "../invocation.js";
import { executeImport, installImportAgentSkills } from "../run.js";

/** The marker a successful Compose import leaves in the target directory. */
function markImported(dir: string): void {
  fs.mkdirSync(path.join(dir, ".flisk"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".flisk", "project.json"), '{"project":{"name":"legacy"}}\n');
}

/** A spawn double that simulates a successful import by leaving `.flisk/project.json` in `dir`. */
function importerSpawn(dir: string, outcome: SpawnOutcome = { code: 0 }) {
  const inner = fakeSpawn(outcome);
  const innerFn = inner.spawnFn as unknown as (
    command: string,
    args: string[],
    options: unknown,
  ) => unknown;
  const spawnFn = ((command: string, args: string[], options: unknown) => {
    const child = innerFn(command, args, options);
    markImported(dir);
    return child;
  }) as never;
  return { calls: inner.calls, spawnFn };
}

const IMPORTER_OUTPUT = [
  "Plan for ./legacy (stack legacy):",
  "  api   create  services/legacy/api/service.json",
  "  wrote services/legacy/api/service.json",
  "",
  "Wrote 1 service.json file(s).",
  "",
].join("\n");

describe("installImportAgentSkills", () => {
  it("writes AGENTS.md and both skill trees into an imported project", () => {
    const dir = createTempDir();
    markImported(dir);
    const written = installImportAgentSkills(dir);
    expect(written).toContain("AGENTS.md");
    expect(written).toContain(path.join(".agents", "skills", "flisk-build", "SKILL.md"));
    expect(fs.existsSync(path.join(dir, ".claude", "skills", "flisk-build", "SKILL.md"))).toBe(
      true,
    );
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8")).toContain("flisk up");
  });

  it("writes nothing when the import left no project.json", () => {
    const dir = createTempDir();
    expect(installImportAgentSkills(dir)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("writes nothing on a dry run or with --no-agent-skills", () => {
    const dry = createTempDir();
    const off = createTempDir();
    markImported(dry);
    markImported(off);
    expect(installImportAgentSkills(dry, { dryRun: true })).toEqual([]);
    expect(installImportAgentSkills(off, { agentSkills: false })).toEqual([]);
    expect(fs.existsSync(path.join(dry, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(off, "AGENTS.md"))).toBe(false);
  });

  it("leaves an existing AGENTS.md alone and prints the Flisk section hint", () => {
    const dir = createTempDir();
    markImported(dir);
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# my own notes\n");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const written = installImportAgentSkills(dir);
      expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8")).toBe("# my own notes\n");
      expect(written).not.toContain("AGENTS.md");
      expect(written.some((p) => p.endsWith("SKILL.md"))).toBe(true);
      expect(err).toHaveBeenCalledWith(expect.stringContaining("AGENTS.md already exists"));
    } finally {
      err.mockRestore();
    }
  });

  it("never overwrites a skill file the project already has", () => {
    const dir = createTempDir();
    markImported(dir);
    const own = path.join(dir, ".claude", "skills", "flisk-build", "SKILL.md");
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, "# mine\n");
    installImportAgentSkills(dir);
    expect(fs.readFileSync(own, "utf-8")).toBe("# mine\n");
  });
});

describe("executeImport writes the agent skills", () => {
  it("installs them after a successful terminal import", async () => {
    const dir = createTempDir();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.spawn.mockImplementation(importerSpawn(dir).spawnFn);
    try {
      await executeImport([dir, "--yes"], {});
      expect(process.exitCode).toBe(0);
      expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(dir, ".agents", "skills", "flisk-up", "SKILL.md"))).toBe(true);
      expect(err).toHaveBeenCalledWith(
        expect.stringContaining("wrote AGENTS.md and the Flisk agent skills"),
      );
    } finally {
      process.exitCode = undefined;
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("skips them with the opt-out, on a dry run, and on a failed run", async () => {
    const optedOut = createTempDir();
    const dry = createTempDir();
    const failed = createTempDir();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.spawn.mockImplementation(importerSpawn(optedOut).spawnFn);
    try {
      await executeImport([optedOut, "--yes"], { agentSkills: false });
      expect(fs.existsSync(path.join(optedOut, "AGENTS.md"))).toBe(false);
    } finally {
      process.exitCode = undefined;
      mocks.spawn.mockReset();
    }
    mocks.spawn.mockImplementation(importerSpawn(dry).spawnFn);
    try {
      await executeImport([dry, "--yes", "--dry-run"], { dryRun: true });
      expect(fs.existsSync(path.join(dry, "AGENTS.md"))).toBe(false);
    } finally {
      process.exitCode = undefined;
      mocks.spawn.mockReset();
    }
    mocks.spawn.mockImplementation(importerSpawn(failed, { code: 1 }).spawnFn);
    try {
      await executeImport([failed, "--yes"], {});
      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(path.join(failed, "AGENTS.md"))).toBe(false);
    } finally {
      process.exitCode = undefined;
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("installs them on the --json path while the envelope stays clean", async () => {
    const dir = createTempDir();
    const legacy = path.join(dir, "legacy");
    fs.mkdirSync(legacy);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    mocks.spawn.mockImplementation(
      importerSpawn(legacy, { code: 0, stdout: IMPORTER_OUTPUT }).spawnFn,
    );
    try {
      await executeImport([legacy], { json: true });
      const stdout = write.mock.calls.map((call) => String(call[0])).join("");
      const envelope = JSON.parse(stdout);
      expect(envelope.errors).toEqual([]);
      // The human notes stay off stderr under --json, like the rest of the import report.
      expect(err).not.toHaveBeenCalled();
      expect(envelope.data.dir).toBe(legacy);
      expect(fs.existsSync(path.join(legacy, "AGENTS.md"))).toBe(true);
      expect(
        fs.existsSync(path.join(legacy, ".claude", "skills", "flisk-doctor", "SKILL.md")),
      ).toBe(true);
    } finally {
      write.mockRestore();
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });

  it("does not install them for a tiltfile import", async () => {
    const dir = createTempDir();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.spawn.mockImplementation(importerSpawn(dir).spawnFn);
    try {
      await executeImport([TILTFILE_IMPORTER, dir, "--yes"], {});
      expect(process.exitCode).toBe(0);
      expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    } finally {
      process.exitCode = undefined;
      err.mockRestore();
      mocks.spawn.mockReset();
    }
  });
});
