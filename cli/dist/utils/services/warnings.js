// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { relative, sep } from "node:path";
import { findProjectRoot } from "../paths.js";
/**
 * A warn-once warning printer with its own dedup state.
 *
 * Discovery may be invoked more than once per process, so the printer remembers what was
 * already shown and prints each warning once. Pass a collecting `print` in tests instead
 * of spying on the console.
 */
export function createServiceWarnings(print = (line) => console.warn(line)) {
    const printed = new Set();
    return {
        warnOnce(key, line) {
            if (printed.has(key))
                return;
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
export function printServiceWarningOnce(warning) {
    serviceWarnings.warnOnce(warning, `⚠️  ${warning}`);
}
export function resetPrintedServiceWarnings() {
    serviceWarnings.reset();
}
export function warnAboutSkippedFiles(problems) {
    for (const problem of problems) {
        printServiceWarningOnce(`skipped ${problem.path}: ${problem.reason}`);
    }
}
/**
 * The `skipped` field of a `--json` envelope: each service.json that discovery skipped, with its path relative to the
 * project root (as `config verify --json` names it) and the reason. Empty when nothing was skipped, so callers can
 * spread it and leave the field out.
 */
export function skippedServiceFiles(problems, projectRoot = findProjectRoot()) {
    if (problems.length === 0)
        return {};
    return {
        skipped: problems.map((problem) => ({
            file: (projectRoot ? relative(projectRoot, problem.path) : problem.path).split(sep).join("/"),
            reason: problem.reason,
        })),
    };
}
