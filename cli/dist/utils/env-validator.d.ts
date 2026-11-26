export interface EnvVariable {
    name: string;
    description: string;
    required: boolean;
    default?: string;
    example?: string;
    /** Written by `completeEnvFile` when a project's .env lacks it (a generated value, or the default). */
    complete?: boolean;
}
export interface EnvKeyOptions {
    /** False for a project that does not use the shared PostgreSQL: DB_PASSWORD and DATABASE_URL are then neither added nor required. */
    databaseKeys?: boolean;
    /** True only when the project asks for the paid Verdaccio service: its two URLs are otherwise not written or required. */
    verdaccio?: boolean;
    /** Checkout whose `DATABASE_URL` database name carries a suffix in a linked git worktree (#4698). */
    projectRoot?: string;
}
/**
 * The keys `completeEnvFile` keeps complete in the project `.env`. An env file that replaces the
 * project `.env` for a run (`flisk up --env-file`) carries the same keys, so it is read from here
 * instead of from a second list.
 */
export declare const COMPLETED_ENV_VARS: string[];
/** Parses the Compose-compatible subset used by Flisk for project environment files. */
export declare function parseEnv(content: string): Map<string, string>;
export declare function generateEnvFile(options?: EnvKeyOptions): string;
export declare function validateEnvFile(projectRoot: string, options?: EnvKeyOptions): {
    missing: string[];
    invalid: string[];
    warnings: string[];
};
/**
 * Appends missing keys a newer CLI expects and fills empty generated keys in place.
 * Non-empty values are not changed. Creates the file when it is missing.
 *
 * @returns the names that were added or filled in, empty when the file was already complete
 */
export declare function completeEnvFile(projectRoot: string, options?: EnvKeyOptions): string[];
/**
 * A linked worktree often starts from a copy of the main checkout's `.env`. Flisk-generated `DATABASE_URL` values must
 * follow the worktree's database even though `completeEnvFile` never overwrites an existing value (#4698). A URL to
 * another host or another database is the project author's choice and is left alone.
 *
 * @returns true when the file was changed
 */
export declare function scopeCheckoutEnvFile(projectRoot: string): boolean;
export declare function ensureEnvFile(projectRoot: string, options?: EnvKeyOptions): boolean;
/**
 * Rewrites a freshly generated project `.env` with the keys the finished project needs. `flisk project --yes` creates the
 * file before `flisk create` adds the resources, so at that point a local-processes project still looks like an empty one
 * (#3711). `flisk create` calls this once the resources exist. Values already in the file are kept for keys that remain,
 * so a generated secret is not rotated; keys the project does not need are left out.
 */
export declare function regenerateEnvFile(projectRoot: string, options?: EnvKeyOptions): string[];
