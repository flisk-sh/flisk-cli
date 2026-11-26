// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import type { CheckResult } from "../types/index.js";
import { type DoctorCheckFn, doctorCheckName } from "./doctor-runner.js";

/**
 * Live per-check progress for `flisk doctor` in plain mode. A check that never finishes keeps its
 * name on screen, so a wedged machine shows which check is stuck instead of sitting at
 * "Checking environment..." forever.
 *
 * Two modes, mirroring `flisk up` progress: an interactive terminal redraws one line listing the
 * checks still running; a pipe, CI or dumb terminal prints a line per check start and finish.
 * Progress goes to stderr so plain-mode stdout and `--json` output stay clean.
 */
export interface DoctorProgress {
  onCheckStart: (check: DoctorCheckFn) => void;
  onCheckFinish: (check: DoctorCheckFn, result?: CheckResult) => void;
  /** Clears the in-place line before the results report prints; a no-op for plain lines. */
  finish: () => void;
}

function progressSymbol(result: CheckResult | undefined): string {
  if (!result || (!result.didPass && !result.isSkipped && !result.isWarning)) return chalk.red("✗");
  if (result.isWarning) return chalk.yellow("⚠");
  if (result.isSkipped) return chalk.gray("○");
  return chalk.green("✓");
}

export function createDoctorProgress(options: {
  write: (text: string) => void;
  /** Redraw one status line in place (TTY). False prints plain lines. */
  redraw: boolean;
  /** Terminal width; the live line is cut to it so it never wraps. */
  columns?: number;
}): DoctorProgress {
  const pending = new Map<DoctorCheckFn, string>();
  let lineShown = false;

  const clearLine = (): void => {
    if (lineShown) options.write("\r\x1b[2K");
    lineShown = false;
  };

  const redrawLine = (): void => {
    if (pending.size === 0) {
      clearLine();
      return;
    }
    const width = Math.max(20, (options.columns ?? 80) - 1);
    const line = `⏳ Checking: ${[...pending.values()].join(", ")}`;
    options.write(`\r\x1b[2K${line.length > width ? `${line.slice(0, width - 1)}…` : line}`);
    lineShown = true;
  };

  return {
    onCheckStart(check) {
      const name = doctorCheckName(check);
      pending.set(check, name);
      if (options.redraw) {
        redrawLine();
      } else {
        options.write(`${chalk.dim("→")} Checking ${name}\n`);
      }
    },
    onCheckFinish(check, result) {
      const name = pending.get(check) ?? result?.name ?? doctorCheckName(check);
      pending.delete(check);
      if (options.redraw) {
        redrawLine();
      } else {
        options.write(`${progressSymbol(result)} ${result?.name ?? name}\n`);
      }
    },
    finish() {
      if (options.redraw) clearLine();
    },
  };
}
