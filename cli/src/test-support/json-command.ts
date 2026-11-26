// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { Command } from "commander";
import { type MockInstance, vi } from "vitest";

export interface JsonCommandCapture {
  /** The `process.exit` spy; only valid inside `inspect`, before the spies are restored. */
  exit: MockInstance;
  /** Raw `console.log` lines captured from the command. */
  lines: string[];
}

/**
 * Runs a Commander command that prints a JSON envelope, capturing its output and exit spy. `inspect` can assert on
 * them while the spies are still live; all spies are restored before the function returns.
 */
export async function captureJsonCommand(
  command: Command,
  args: string[],
  inspect?: (capture: JsonCommandCapture) => void | Promise<void>,
): Promise<{ lines: string[] }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  try {
    await command.parseAsync(args, { from: "user" });
    await inspect?.({ exit, lines });
  } finally {
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();
  }
  return { lines };
}
