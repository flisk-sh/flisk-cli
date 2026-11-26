/** Options shared with {@link getCheckoutId}; `persist: false` derives an id without writing `.project-id`. */
export interface CheckoutDatabaseOptions {
    persist?: boolean;
}
/**
 * True for a linked git worktree: its `.git` is a file whose contents start with `gitdir:`.
 *
 * The main checkout has a `.git` directory, and a plain copied folder has no `.git` at all. Only linked worktrees get a
 * database suffix (#4698); both of those stay on the historical names.
 */
export declare function isLinkedGitWorktree(projectRoot: string): boolean;
/**
 * The `_<checkout id>` suffix for a linked git worktree, or the empty string for the main checkout.
 *
 * Uses the stable per-checkout id from #4694: every process in one worktree resolves the same id, while two worktrees of
 * the same repository resolve different ones. The id is lowercase hex, so it is already a valid Postgres identifier.
 */
export declare function checkoutDatabaseSuffix(projectRoot: string | undefined, options?: CheckoutDatabaseOptions): string;
/**
 * Appends the checkout suffix to a database name and keeps the result within PostgreSQL's 63-byte identifier limit.
 *
 * Postgres truncates longer identifiers from the end, which would cut off the checkout id and let two worktrees share
 * a database. A name that would not fit is shortened in its base part and given an 8-hex hash of the full base, so the
 * suffix stays intact and two long names that share a prefix stay distinct. Names that fit are unchanged. A name that
 * already ends with the suffix is returned as is.
 */
export declare function scopeDatabaseName(base: string, suffix: string): string;
/**
 * Name of the shared-Postgres database for one stack of a project.
 *
 * Main checkouts keep the historical `<project>_<stack>` name. A linked git worktree gets
 * `<project>_<stack>_<FLISK_CHECKOUT_ID>` so parallel agents do not write to each other's database (#4698).
 */
export declare function sharedPostgresDatabaseName(projectName: string, stack: string, projectRoot?: string, options?: CheckoutDatabaseOptions): string;
/**
 * Adds the same checkout suffix to the database segment of a Postgres URL, preserving its query string.
 *
 * A worktree's copied `.env` still names the main checkout's database; local services that depend on the shared
 * Postgres must resolve to the worktree's database instead (#4698). An already-suffixed URL is left unchanged.
 */
export declare function checkoutScopedDatabaseUrl(url: string, projectRoot?: string, options?: CheckoutDatabaseOptions): string;
/** The database segment of a Postgres URL, or an empty string when the URL has none. */
export declare function databaseNameFromUrl(url: string): string;
/**
 * Refuses to start a linked git worktree whose checkout id is not stored in `.flisk/.project-id`.
 *
 * `getCheckoutId` silently falls back to a derived id when it cannot write the record (a read-only folder). The
 * Starlark engine reads only the record and would then use the main checkout's database names while the CLI scoped
 * its own to the fallback id, so the worktree could migrate the main checkout's data (#4698). Stop instead.
 */
export declare function assertCheckoutIdentityPersisted(projectRoot: string): void;
