// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { vi } from "vitest";

/** Thrown by a stubbed `process.exit` so the code under test stops where it would have exited. */
export class ExitSignal extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const originalArgv = process.argv;

/** Replaces `process.exit` with a stub that throws an {@link ExitSignal}. */
export function throwOnExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code);
  }) as never);
}

/** Collects what the command prints through `console.log` (or another console method), one entry per call. */
export function captureConsole(method: "log" | "error" | "warn" = "log"): string[] {
  const lines: string[] = [];
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

/** Runs cli.ts from scratch with the given arguments and returns the exit code it decided. */
export async function importCli(...args: string[]): Promise<number | undefined> {
  vi.resetModules();
  process.argv = [originalArgv[0], "/fake/bin/flisk.js", ...args];

  try {
    await import("../cli.js");
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }

  return undefined;
}

/** Puts `process.argv` back after {@link importCli}. */
export function restoreArgv(): void {
  process.argv = originalArgv;
}
