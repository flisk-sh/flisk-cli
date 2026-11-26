import type { DiscoveryProblem } from "../../types/index.js";
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
export declare function createServiceWarnings(print?: ServiceWarningPrint): ServiceWarnings;
/**
 * Print `warning` once per process. Manifest validation warnings and skipped-file
 * warnings share this dedup set, so {@link resetPrintedServiceWarnings} clears both.
 */
export declare function printServiceWarningOnce(warning: string): void;
export declare function resetPrintedServiceWarnings(): void;
export declare function warnAboutSkippedFiles(problems: DiscoveryProblem[]): void;
/**
 * The `skipped` field of a `--json` envelope: each service.json that discovery skipped, with its path relative to the
 * project root (as `config verify --json` names it) and the reason. Empty when nothing was skipped, so callers can
 * spread it and leave the field out.
 */
export declare function skippedServiceFiles(problems: readonly DiscoveryProblem[], projectRoot?: string | null): {
    skipped?: {
        file: string;
        reason: string;
    }[];
};
