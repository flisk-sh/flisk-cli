import type { DockerRun } from "./project-purge.js";
/** The shared Postgres container Flisk generates for a project. */
export declare function sharedPostgresContainer(projectName: string): string;
/** The shared Postgres data volume Flisk generates for a project, under both Compose's old and new naming. */
export declare function isSharedPostgresVolume(volume: string, projectName: string): boolean;
/** The logical databases of `projectName` that belong to one checkout, derived from the checkout suffix. */
export declare function checkoutDatabaseDropPlan(databases: readonly string[], suffix: string): string[];
export interface CheckoutDatabaseDrop {
    /** The suffix that identifies this checkout, or "" for the main checkout. */
    suffix: string;
    /** Databases that matched this checkout and were dropped. */
    dropped: string[];
    /** Databases that matched but Docker/Postgres refused to drop. */
    kept: {
        name: string;
        reason: string;
    }[];
    /** Why no database was dropped, when the Postgres container could not be queried. */
    skipped?: string;
}
/**
 * Drops only the current checkout's logical databases from the project's shared Postgres (#4698).
 *
 * The Postgres container and its data volume are shared by a main checkout and its linked worktrees, so a worktree's
 * `flisk down --purge` must not remove the volume. The caller filters that volume out; this function removes the
 * checkout's databases before the container is stopped. A missing or stopped container is a no-op, not a failure.
 */
export declare function dropCheckoutDatabases(projectName: string, suffix: string, docker?: DockerRun): CheckoutDatabaseDrop;
