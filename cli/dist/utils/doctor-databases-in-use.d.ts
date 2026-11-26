import type { CheckResult, DiscoveredStack } from "../types/index.js";
import { type RunDatabaseUse } from "./run-databases.js";
/** One shared-Postgres database a running checkout actually uses. */
export interface DatabaseInUse {
    root: string;
    projectName: string;
    stack: string;
    database: string;
}
export interface DatabaseInUseLookup {
    /** Roots with a running stack (a `tilt up` on the generated Tiltfile, or a live native run). */
    runningRoots: () => Promise<string[]> | string[];
    /** The databases the run on record uses, or null when the run predates `.flisk/run/databases.json`. */
    recordedUses: (root: string) => RunDatabaseUse[] | null;
    /** The checkout's discovered stacks, for the next-start fallback when no record exists. */
    stacksIn: (root: string) => DiscoveredStack[];
    /** `.flisk/project.json` `project.name`, lowercased; the root is skipped without one. */
    projectNameIn: (root: string) => string | undefined;
}
/** Groups in-use databases by name; only names claimed by more than one running checkout matter. */
export declare function duplicateDatabasesInUse(uses: readonly DatabaseInUse[]): Map<string, DatabaseInUse[]>;
/** Pure doctor message builder, so the warning can be tested without a Docker daemon or live Tilt. */
export declare function describeDatabasesInUseCollisions(duplicates: ReadonlyMap<string, DatabaseInUse[]>): string | null;
/**
 * `flisk doctor` warning for two running stacks that claim the same shared-Postgres database right now (#5132).
 *
 * `flisk up` records the database names the run uses in `.flisk/run/databases.json`, and this check compares those
 * recorded names, not the names the next `flisk up` would derive. That catches a stack still running on a name a
 * naming change has since retired: a linked worktree started before databases got checkout-scoped names keeps
 * sharing the main checkout's unsuffixed database, which the next-start comparison reports as no collision.
 * A freshly started worktree records its own distinct databases and does not warn. The check never connects to
 * Postgres: it reads each running checkout's record and falls back to derived names for a run that predates it.
 */
export declare function checkDatabaseNamesInUse(lookup?: DatabaseInUseLookup): Promise<CheckResult>;
