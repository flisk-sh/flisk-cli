// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { relative, sep } from "node:path";
import type { DiscoveryProblem } from "../../types/index.js";
import { findProjectRoot } from "../paths.js";

/** One already-formatted warning line, ready to show the user. */
export type ServiceWarningPrint = (line: string) => void;

export interface ServiceWarnings {
  /** Print `line` once per unique `key`; later calls with the same key stay silent. */
  warnOnce(key: string, line: string): void;
  /** Forget every printed key, so each warning can print again. */
  reset(): void;
}

/**
 * A warn-once warning printer with its own dedup state.
 *
 * Discovery may be invoked more than once per process, so the printer remembers what was
 * already shown and prints each warning once. Pass a collecting `print` in tests instead
 * of spying on the console.
 */
export function createServiceWarnings(
  print: ServiceWarningPrint = (line) => console.warn(line),
): ServiceWarnings {
  const printed = new Set<string>();
  return {
    warnOnce(key, line) {
      if (printed.has(key)) return;
      printed.add(key);
      print(line);
    },
    reset() {
      printed.clear();
    },
  };
}

const serviceWarnings = createServiceWarnings();

/**
 * Print `warning` once per process. Manifest validation warnings and skipped-file
 * warnings share this dedup set, so {@link resetPrintedServiceWarnings} clears both.
 */
export function printServiceWarningOnce(warning: string): void {
  serviceWarnings.warnOnce(warning, `⚠️  ${warning}`);
}

export function resetPrintedServiceWarnings(): void {
  serviceWarnings.reset();
}

export function warnAboutSkippedFiles(problems: DiscoveryProblem[]): void {
  for (const problem of problems) {
    printServiceWarningOnce(`skipped ${problem.path}: ${problem.reason}`);
  }
}

/**
 * The `skipped` field of a `--json` envelope: each service.json that discovery skipped, with its path relative to the
 * project root (as `config verify --json` names it) and the reason. Empty when nothing was skipped, so callers can
 * spread it and leave the field out.
 */
export function skippedServiceFiles(
  problems: readonly DiscoveryProblem[],
  projectRoot: string | null = findProjectRoot(),
): { skipped?: { file: string; reason: string }[] } {
  if (problems.length === 0) return {};
  return {
    skipped: problems.map((problem) => ({
      file: (projectRoot ? relative(projectRoot, problem.path) : problem.path).split(sep).join("/"),
      reason: problem.reason,
    })),
  };
}
