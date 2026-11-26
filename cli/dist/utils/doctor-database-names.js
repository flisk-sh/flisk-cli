// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { findRunningFliskProjects } from "./down-cleanup.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { discoverResourcesWithProblems, discoverStacks } from "./services.js";
import { groupSharedPostgres } from "./shared-infra.js";
const defaultLookup = {
    runningRoots: () => findRunningFliskProjects(),
    stacksIn: (root) => discoverStacks(discoverResourcesWithProblems(root).resources),
};
/** Groups database-name uses by name; only names claimed by more than one running checkout matter. */
export function duplicateDatabaseNameUses(uses) {
    const byName = new Map();
    for (const use of uses) {
        const existing = byName.get(use.database) ?? [];
        existing.push(use);
        byName.set(use.database, existing);
    }
    return new Map([...byName].filter(([, group]) => group.length > 1));
}
/** Pure doctor message builder, so the warning can be tested without a Docker daemon or live Tilt. */
export function describeDatabaseNameCollisions(duplicates) {
    if (duplicates.size === 0)
        return null;
    const details = [...duplicates].map(([database, uses]) => {
        const owners = [...new Set(uses.map((use) => `${use.projectName}/${use.stack} (${use.root})`))];
        return `${database}: ${owners.join(", ")}`;
    });
    return (`${duplicates.size} shared-Postgres database name${duplicates.size === 1 ? " is" : "s are"} used by more than one running stack: ${details.join("; ")}. ` +
        "These stacks write to the same database and can corrupt each other's data. Linked git worktrees get their own FLISK_CHECKOUT_ID suffix on the next `flisk up`.");
}
/**
 * `flisk doctor` warning for two running stacks that resolve to the same shared-Postgres database (#4698).
 *
 * Worktrees now carry a checkout suffix, so a collision means two main checkouts (or a stale stack started before the
 * fix) still share one database. The check never connects to Postgres: it compares the names the CLI and engine derive.
 */
export async function checkDuplicateDatabaseNames(lookup = defaultLookup) {
    const roots = await lookup.runningRoots();
    const uses = [];
    for (const root of roots) {
        const projectName = readProjectNameOrUndefined(root);
        if (!projectName)
            continue;
        const group = groupSharedPostgres(projectName, lookup.stacksIn(root), { projectRoot: root });
        for (const database of group?.databases ?? []) {
            uses.push({ root, projectName, stack: database.stack, database: database.name });
        }
    }
    const message = describeDatabaseNameCollisions(duplicateDatabaseNameUses(uses));
    return message
        ? {
            name: "Database Name Collisions",
            didPass: true,
            isWarning: true,
            message,
        }
        : {
            name: "Database Name Collisions",
            didPass: true,
            isSkipped: true,
            message: "No shared-Postgres database name is claimed by more than one running stack",
        };
}
