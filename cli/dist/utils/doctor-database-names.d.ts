import type { CheckResult, DiscoveredStack } from "../types/index.js";
/** One database a running checkout resolved for one of its stacks. */
export interface DatabaseNameUse {
    root: string;
    projectName: string;
    stack: string;
    database: string;
}
export interface DatabaseCollisionLookup {
    runningRoots: () => Promise<string[]> | string[];
    stacksIn: (root: string) => DiscoveredStack[];
}
/** Groups database-name uses by name; only names claimed by more than one running checkout matter. */
export declare function duplicateDatabaseNameUses(uses: readonly DatabaseNameUse[]): Map<string, DatabaseNameUse[]>;
/** Pure doctor message builder, so the warning can be tested without a Docker daemon or live Tilt. */
export declare function describeDatabaseNameCollisions(duplicates: ReadonlyMap<string, DatabaseNameUse[]>): string | null;
/**
 * `flisk doctor` warning for two running stacks that resolve to the same shared-Postgres database (#4698).
 *
 * Worktrees now carry a checkout suffix, so a collision means two main checkouts (or a stale stack started before the
 * fix) still share one database. The check never connects to Postgres: it compares the names the CLI and engine derive.
 */
export declare function checkDuplicateDatabaseNames(lookup?: DatabaseCollisionLookup): Promise<CheckResult>;
