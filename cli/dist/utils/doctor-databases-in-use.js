// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { findRunningFliskProjects } from "./down-cleanup.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { readRunDatabases } from "./run-databases.js";
import { discoverResourcesWithProblems, discoverStacks } from "./services.js";
import { groupSharedPostgres } from "./shared-infra.js";
const defaultLookup = {
    runningRoots: () => findRunningFliskProjects(),
    recordedUses: (root) => readRunDatabases(root),
    stacksIn: (root) => discoverStacks(discoverResourcesWithProblems(root).resources),
    projectNameIn: (root) => readProjectNameOrUndefined(root),
};
/**
 * What a running root's stacks use. The record `flisk up` wrote names what this run actually claims; a run without
 * one was started before the record existed, so the names a fresh `flisk up` would derive stand in for it, the
 * same answer on a checkout that has never renamed its databases (#5132).
 */
function databasesInUse(root, projectName, lookup) {
    const recorded = lookup.recordedUses(root);
    if (recorded !== null)
        return recorded;
    const group = groupSharedPostgres(projectName, lookup.stacksIn(root), { projectRoot: root });
    return (group?.databases ?? []).map(({ stack, name }) => ({ stack, name }));
}
/** Groups in-use databases by name; only names claimed by more than one running checkout matter. */
export function duplicateDatabasesInUse(uses) {
    const seen = new Set();
    const byName = new Map();
    for (const use of uses) {
        if (!seen.add(`${use.root}${use.database}`))
            continue;
        const existing = byName.get(use.database) ?? [];
        existing.push(use);
        byName.set(use.database, existing);
    }
    return new Map([...byName].filter(([, group]) => group.length > 1));
}
/** Pure doctor message builder, so the warning can be tested without a Docker daemon or live Tilt. */
export function describeDatabasesInUseCollisions(duplicates) {
    if (duplicates.size === 0)
        return null;
    const details = [...duplicates].map(([database, uses]) => {
        const owners = [...new Set(uses.map((use) => `${use.projectName}/${use.stack} (${use.root})`))];
        return `${database}: ${owners.join(", ")}`;
    });
    return (`${duplicates.size} shared-Postgres database name${duplicates.size === 1 ? " is" : "s are"} in use by more than one running stack: ${details.join("; ")}. ` +
        "These running stacks write to the same database and can corrupt each other's data. A stack started before a " +
        "database-name change keeps its old name until it restarts, so the names a fresh `flisk up` would derive may look distinct.");
}
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
export async function checkDatabaseNamesInUse(lookup = defaultLookup) {
    const roots = await lookup.runningRoots();
    const uses = [];
    for (const root of roots) {
        const projectName = lookup.projectNameIn(root);
        if (!projectName)
            continue;
        for (const use of databasesInUse(root, projectName, lookup)) {
            uses.push({ root, projectName, stack: use.stack, database: use.name });
        }
    }
    const message = describeDatabasesInUseCollisions(duplicateDatabasesInUse(uses));
    if (message) {
        return {
            name: "Database Names In Use",
            didPass: true,
            isWarning: true,
            message,
            fix: "Run `flisk down` on one of the checkouts sharing a database, then `flisk up` it again so it starts on the database names a fresh run would use",
        };
    }
    return uses.length === 0
        ? {
            name: "Database Names In Use",
            didPass: true,
            isSkipped: true,
            message: "No running stack uses a shared-Postgres database",
        }
        : {
            name: "Database Names In Use",
            didPass: true,
            message: "Every shared-Postgres database in use is claimed by only one running stack",
        };
}
