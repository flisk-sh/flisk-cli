// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { afterAll, beforeAll, type Mock, vi } from "vitest";
import { getRegisteredCommands } from "../../../commands/registry.js";
import { createFliskTools, type FliskRun, type UpDeps } from "../../tools.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

export function getSpawnMock(): Mock {
  return spawnMock;
}

export function resetSpawnMock() {
  spawnMock.mockReset();
}

export function createProjectFixture() {
  let projectDir = "";
  let notADirectory = "";
  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "flisk-mcp-project-"));
    notADirectory = join(projectDir, "not-a-directory.txt");
    writeFileSync(notADirectory, "not a directory\n");
  });
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });
  return {
    get projectDir() {
      return projectDir;
    },
    get notADirectory() {
      return notADirectory;
    },
  };
}

export function recordingTools(
  stdout: string,
  result: Partial<FliskRun> = {},
  up?: UpDeps,
): {
  seen: { args: string[]; cwd?: string; timeoutMs?: number }[];
  tools: ReturnType<typeof createFliskTools>;
} {
  const seen: { args: string[]; cwd?: string; timeoutMs?: number }[] = [];
  const tools = createFliskTools(async (args, options) => {
    seen.push({
      args,
      cwd: options?.cwd,
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    return { exitCode: 0, stdout, stderr: "", ...result };
  }, up);
  return { seen, tools };
}

export function loadRegisteredCommandMap(): Map<string, Command> {
  const byName = new Map<string, Command>();
  for (const cmd of getRegisteredCommands()) {
    byName.set(cmd.name(), cmd);
    for (const alias of cmd.aliases()) byName.set(alias, cmd);
  }
  return byName;
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: Mock;
  pid: number;
};

export function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    pid: 123,
  });
}

export function fakeUp(options: { logs: string[]; exitAfter?: { atRead: number; code: number } }): {
  deps: UpDeps;
  child: EventEmitter & { pid: number; unref: () => void };
  logFile: string;
} {
  // A path no other file can occupy, so the real rmSync cleanup in startUp never touches an unrelated file.
  const logFile = join(tmpdir(), `flisk-fake-up-${randomUUID()}`, "up.log");
  const child = Object.assign(new EventEmitter(), { pid: 4242, unref: vi.fn() });
  let reads = 0;
  let clock = 0;
  const deps: UpDeps = {
    spawnUp: vi.fn(() => child as never),
    readLog: () => {
      const text = options.logs[Math.min(reads, options.logs.length - 1)] ?? "";
      reads += 1;
      if (options.exitAfter && reads === options.exitAfter.atRead)
        child.emit("exit", options.exitAfter.code);
      return text;
    },
    sleep: async () => {
      clock += 1000;
    },
    now: () => clock,
    logFile: () => logFile,
  };
  return { deps, child, logFile };
}
