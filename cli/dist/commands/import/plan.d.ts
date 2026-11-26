/**
 * Parses the plan the pinned flisk-import prints on stdout (before it writes, or the whole output of
 * a --dry-run), so `flisk import --json` can report it as fields an agent branches on instead of
 * terminal text. The importer has no machine output of its own; the pinned version keeps this format
 * stable, the importer's own text stays on `output`, and a line the parser does not know is left out
 * of the structured fields rather than guessed at.
 */
/** What the plan says happens to one file: a fresh write, a kept file, or a --force overwrite. */
export interface ImportPlannedWrite {
    path: string;
    action: "create" | "exists-kept" | "overwrite";
}
/** One service in the plan, with the decisions the importer made on it. */
export interface ImportPlannedService {
    name: string;
    kind: string;
    /** The service's own directory inside the imported root, when it has one (`api` for `api/`). */
    dir?: string;
    image?: string;
    /** The build context and Dockerfile, split out of the plan's `dir/ with Dockerfile` line. */
    build?: {
        context: string;
        dockerfile?: string;
    };
    /** The port the service.json gets, whether Compose named it or the importer assigned it. */
    port?: number;
    /** How the service is reached: "traefik" routes it, "none" keeps it private. */
    proxy?: "traefik" | "none";
    healthCheckPath?: string;
    /** True when the importer assumed the health path instead of reading one from Compose. */
    healthCheckAssumed?: boolean;
    dependsOn: string[];
    /** The service.json the plan writes or keeps; absent when the service was rejected. */
    write?: ImportPlannedWrite;
    /** Why the plan's "not written" line rejects this service. */
    notWrittenReason?: string;
    notes: string[];
}
/** A "Skipped / not fully imported" line: the source that was not read and why. */
export interface ImportPlanSkip {
    /** The file (and line, when the importer names one) the skip comes from. */
    source: string;
    /** The importer detector that reported the skip, e.g. "compose". */
    detector?: string;
    reason: string;
    /** The process names a skipped Procfile declares; absent for the importer's own skips. */
    processes?: string[];
}
/** The plan the importer printed: its services, its skipped sources and the files it will write. */
export interface ImportPlan {
    services: ImportPlannedService[];
    skipped: ImportPlanSkip[];
    /** Every path the plan writes: .flisk/project.json plus each created or overwritten service.json. */
    planned: string[];
}
/** The `services`, `skipped` and `planned` fields of `flisk import --json`, parsed from `output`. */
export declare function parseImportPlan(stdout: string): ImportPlan;
