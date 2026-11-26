import type { DiscoveredResource } from "../types/index.js";
/** One shared-Postgres database a running checkout actually uses, with the stack it belongs to. */
export interface RunDatabaseUse {
    stack: string;
    name: string;
}
/**
 * Where a run records the shared-Postgres database names it actually uses: `.flisk/run/databases.json`.
 *
 * `flisk up` writes the record at start so `flisk doctor` can compare the names running checkouts claim, not the
 * names a fresh `flisk up` would derive: a stack started before a naming change keeps its old database until it
 * restarts, which the derived names cannot see (#5132). The directory carries the same keep-out-of-git marker
 * `.flisk/native/` uses: the record names this machine's run, so it must never be committed.
 */
export declare const RUN_STATE_DIR: string;
export declare function runDatabasesPath(projectRoot: string): string;
/**
 * The shared-Postgres databases a run of `resources` uses: `groupSharedPostgres` resolves them the same way the
 * next `flisk up` does, so the names a worktree scopes to its checkout are recorded as scoped once that scoping
 * exists (#4698). Empty when no selected resource touches the shared Postgres or the project opts out.
 */
export declare function runDatabaseUses(projectRoot: string, resources: readonly DiscoveredResource[]): RunDatabaseUse[];
/**
 * Records the databases a run uses. Written on every `flisk up` so the record always describes the latest start;
 * an absent or unreadable record only means the check falls back to derived names. Never throws: a read-only
 * checkout loses the record, not the run.
 */
export declare function writeRunDatabases(projectRoot: string, uses: readonly RunDatabaseUse[]): void;
/** The databases the run on record uses, or null when no complete record exists. */
export declare function readRunDatabases(projectRoot: string): RunDatabaseUse[] | null;
