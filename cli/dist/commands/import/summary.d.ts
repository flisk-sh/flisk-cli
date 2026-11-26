/** One line of the import coverage summary: a Compose feature that did not translate exactly. */
export interface CoverageFinding {
    /** The feature and what the importer did with it. */
    label: string;
    /** The anchor on docs/project/ADOPTER-COVERAGE.md naming the coverage row. */
    anchor: string;
}
/** The summary of what an import dropped, approximated or skipped by design. */
export interface ImportCoverage {
    dropped: CoverageFinding[];
    approximated: CoverageFinding[];
    byDesign: CoverageFinding[];
}
/**
 * Reads the importer's printed plan into the summary: the per-service `note:` lines and the
 * "Skipped / not fully imported:" lines, bucketed as dropped, approximated or by design. Scan
 * notes and purely informational lines (port publication, env hints) are left out.
 */
export declare function importCoverage(importerStdout: string): ImportCoverage;
/** The files the importer says it read, from the plan's "Read only: a, b." line. */
export declare function importedFiles(importerStdout: string): string[];
/**
 * The custom networks a Compose file declares: children of the top-level `networks:` map and
 * the names a service `networks:` entry gives. `default` is Compose's own, so it never counts.
 * The importer collapses these to the one Flisk network without a note, so the summary reads
 * the file itself (#3108).
 */
export declare function customNetworkNames(composeText: string): string[];
/** The `networks` approximation the importer leaves unreported, read from the Compose file. */
export declare function networksFinding(dir: string, files: string[], readFile?: (path: string) => string | null): CoverageFinding | null;
/**
 * The full summary: the plan's findings plus the `networks` approximation the importer does
 * not name. `dir` is the directory argument given to `flisk import`; without it (or when the
 * Compose files cannot be read) the summary reports the plan alone.
 */
export declare function importCoverageSummary(importerStdout: string, options?: {
    dir?: string;
    readFile?: (path: string) => string | null;
}): ImportCoverage;
/**
 * The one block `flisk import` prints after the plan (#3108): each finding with the anchor of
 * its row in docs/project/ADOPTER-COVERAGE.md. Empty when nothing was dropped, approximated or
 * skipped by design.
 */
export declare function formatCoverageBlock(coverage: ImportCoverage): string;
