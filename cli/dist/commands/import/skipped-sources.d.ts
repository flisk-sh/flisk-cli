/** A file the importer leaves alone even though it declares runnable processes. */
export interface SkippedImportSource {
    /** The file name in the import directory, for example `Procfile` or `Procfile.dev`. */
    file: string;
    /** The process names it declares, in file order (`web`, `worker`, ...). */
    processes: string[];
}
/** The directory the importer reads, or null when the forwarded run is a `tiltfile` import. */
export declare function importTargetDir(forwardedArgs: string[]): string | null;
/**
 * The Procfiles sitting next to the root Compose file in `dir`. The importer reads the Compose file
 * and leaves these untouched, so the caller reports them as skipped instead of dropping them silently.
 */
export declare function findSkippedProcfiles(dir: string): SkippedImportSource[];
/** The skipped sibling sources for a forwarded import run; always [] for a `tiltfile` import. */
export declare function skippedImportSources(forwardedArgs: string[]): SkippedImportSource[];
/**
 * The "Skipped / not fully imported" block the CLI adds when `flisk import` leaves sibling Procfiles
 * alone, so the user sees their processes did not move and how to bring each in by hand.
 */
export declare function skippedSourcesNotice(skipped: SkippedImportSource[]): string;
