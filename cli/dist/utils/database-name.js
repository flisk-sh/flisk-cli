// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getCheckoutId, isCheckoutIdPersisted } from "./checkout-id.js";
import { toComposeProjectName } from "./compose-project-name.js";
import { FliskError } from "./errors.js";
/**
 * True for a linked git worktree: its `.git` is a file whose contents start with `gitdir:`.
 *
 * The main checkout has a `.git` directory, and a plain copied folder has no `.git` at all. Only linked worktrees get a
 * database suffix (#4698); both of those stay on the historical names.
 */
export function isLinkedGitWorktree(projectRoot) {
    try {
        const dotGit = join(projectRoot, ".git");
        if (!statSync(dotGit).isFile())
            return false;
        return readFileSync(dotGit, "utf8").trimStart().startsWith("gitdir:");
    }
    catch {
        return false;
    }
}
/**
 * The `_<checkout id>` suffix for a linked git worktree, or the empty string for the main checkout.
 *
 * Uses the stable per-checkout id from #4694: every process in one worktree resolves the same id, while two worktrees of
 * the same repository resolve different ones. The id is lowercase hex, so it is already a valid Postgres identifier.
 */
export function checkoutDatabaseSuffix(projectRoot, options = {}) {
    if (!projectRoot || !isLinkedGitWorktree(projectRoot))
        return "";
    return `_${getCheckoutId(projectRoot, options)}`;
}
const POSTGRES_IDENTIFIER_LIMIT = 63;
// Shared verbatim with constants.star: both sides must shorten a long name to the same bytes.
const HASH_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-.";
/** 32-bit FNV-1a over the name, as 8 hex digits. Mirrored in `constants.star` so the CLI and engine agree. */
function nameHash(name) {
    let hash = 2166136261;
    for (const char of name) {
        hash = Math.imul(hash ^ (HASH_ALPHABET.indexOf(char) + 1), 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
/**
 * Appends the checkout suffix to a database name and keeps the result within PostgreSQL's 63-byte identifier limit.
 *
 * Postgres truncates longer identifiers from the end, which would cut off the checkout id and let two worktrees share
 * a database. A name that would not fit is shortened in its base part and given an 8-hex hash of the full base, so the
 * suffix stays intact and two long names that share a prefix stay distinct. Names that fit are unchanged. A name that
 * already ends with the suffix is returned as is.
 */
export function scopeDatabaseName(base, suffix) {
    if (!suffix || base.endsWith(suffix))
        return base;
    if (base.length + suffix.length <= POSTGRES_IDENTIFIER_LIMIT)
        return `${base}${suffix}`;
    const keep = POSTGRES_IDENTIFIER_LIMIT - suffix.length - 9;
    return `${base.slice(0, keep)}_${nameHash(base)}${suffix}`;
}
/**
 * Name of the shared-Postgres database for one stack of a project.
 *
 * Main checkouts keep the historical `<project>_<stack>` name. A linked git worktree gets
 * `<project>_<stack>_<FLISK_CHECKOUT_ID>` so parallel agents do not write to each other's database (#4698).
 */
export function sharedPostgresDatabaseName(projectName, stack, projectRoot, options = {}) {
    const prefix = toComposeProjectName(projectName);
    return scopeDatabaseName(`${prefix}_${stack.replace(/-/g, "_")}`, checkoutDatabaseSuffix(projectRoot, options));
}
/**
 * Adds the same checkout suffix to the database segment of a Postgres URL, preserving its query string.
 *
 * A worktree's copied `.env` still names the main checkout's database; local services that depend on the shared
 * Postgres must resolve to the worktree's database instead (#4698). An already-suffixed URL is left unchanged.
 */
export function checkoutScopedDatabaseUrl(url, projectRoot, options = {}) {
    const suffix = checkoutDatabaseSuffix(projectRoot, options);
    if (!suffix || !url)
        return url;
    const queryIndex = url.indexOf("?");
    const beforeQuery = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const query = queryIndex === -1 ? "" : url.slice(queryIndex);
    const lastSlash = beforeQuery.lastIndexOf("/");
    const database = lastSlash === -1 ? "" : beforeQuery.slice(lastSlash + 1);
    if (!database || database.endsWith(suffix))
        return url;
    return `${beforeQuery.slice(0, lastSlash + 1)}${scopeDatabaseName(database, suffix)}${query}`;
}
/** The database segment of a Postgres URL, or an empty string when the URL has none. */
export function databaseNameFromUrl(url) {
    const beforeQuery = url.split("?", 1)[0] ?? "";
    const lastSlash = beforeQuery.lastIndexOf("/");
    return lastSlash === -1 ? "" : beforeQuery.slice(lastSlash + 1);
}
/**
 * Refuses to start a linked git worktree whose checkout id is not stored in `.flisk/.project-id`.
 *
 * `getCheckoutId` silently falls back to a derived id when it cannot write the record (a read-only folder). The
 * Starlark engine reads only the record and would then use the main checkout's database names while the CLI scoped
 * its own to the fallback id, so the worktree could migrate the main checkout's data (#4698). Stop instead.
 */
export function assertCheckoutIdentityPersisted(projectRoot) {
    if (!isLinkedGitWorktree(projectRoot) || isCheckoutIdPersisted(projectRoot))
        return;
    throw new FliskError(`This git worktree has no readable ${join(".flisk", ".project-id")} record, so its database names cannot be kept apart from the main checkout's.`, [
        `Make ${join(projectRoot, ".flisk")} writable, then run \`flisk up\` again`,
        "Or delete a stale .flisk/.project-id so Flisk can write a new one",
    ]);
}
