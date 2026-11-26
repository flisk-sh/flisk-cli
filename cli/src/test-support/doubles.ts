// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeSync } from "node:fs";
import { expect, type MockInstance, vi } from "vitest";
import type { DiscoveredResource } from "../types/index.js";
import { ProcessExitError } from "../utils/errors.js";

/**
 * Builds an in-memory `DiscoveredResource` for pure tests. Nothing is written to disk; the paths are fake.
 * Use `createTempProject` when a test needs real files.
 */
export function makeResource(
  name: string,
  appType: string,
  config: Record<string, unknown> = {},
): DiscoveredResource {
  return {
    name,
    path: `/tmp/${name}`,
    configPath: `/tmp/${name}/service.json`,
    config: { appName: name, appType, ...config } as DiscoveredResource["config"],
  };
}

export interface ExitCapture {
  /** The spy on `process.exit`. It throws `ProcessExitError`, so the code under test stops where the exit happens. */
  exit: MockInstance;
  /** Asserts that the exit was called with `code` exactly once. */
  expectExit(code: number): void;
}

/**
 * Replaces `process.exit` with a spy that throws. The caller catches the throw, for example with
 * `rejects.toThrow("process.exit")`. Restore it with `vi.restoreAllMocks()` in `afterEach`.
 */
export function captureExit(): ExitCapture {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
  return {
    exit,
    expectExit(code: number) {
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(code);
    },
  };
}

export interface StdoutCapture {
  /** Every chunk written to fd 1 (stdout), in order. */
  readonly chunks: string[];
  /** All chunks joined: what the terminal would have received. */
  text(): string;
  /** The first newline-terminated document, for a command that writes one JSON envelope. */
  firstJsonLine(): string;
}

/**
 * Intercepts `writeSync` so writes to fd 1 (stdout) collect in `chunks` instead of reaching the
 * terminal. The test file must mock `node:fs` `writeSync` as a `vi.fn` first; writes to other
 * descriptors pass through.
 */
export function captureStdoutWrites(): StdoutCapture {
  const chunks: string[] = [];
  const mocked = vi.mocked(writeSync);
  mocked.mockClear();
  mocked.mockImplementation(((fd: number, data: string) => {
    if (fd === 1) chunks.push(String(data));
    return String(data).length;
  }) as typeof writeSync);
  return {
    chunks,
    text: () => chunks.join(""),
    firstJsonLine: () => chunks.join("").trim().split("\n")[0] ?? "",
  };
}

export interface ExitListeners {
  /** The "exit" listeners added since this call; fire one to simulate the process exiting. */
  added(): Array<(code: number) => void>;
  /** Removes every still-registered added listener. */
  release(): void;
}

/**
 * Tracks the "exit" listeners a run registers, so a test can fire them itself and detach the ones
 * still attached afterwards.
 */
export function trackExitListeners(): ExitListeners {
  const before = new Set(process.listeners("exit"));
  const added = () =>
    process.listeners("exit").filter((listener) => !before.has(listener)) as Array<
      (code: number) => void
    >;
  return {
    added,
    release: () => {
      for (const listener of added()) process.removeListener("exit", listener);
    },
  };
}
