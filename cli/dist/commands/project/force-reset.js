// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { writeTextFileAtomic } from "../../utils/atomic-write.js";
function collectLeaves(value, prefix, out) {
    if (Array.isArray(value) || value === null || typeof value !== "object") {
        out.set(prefix || "(root)", value);
        return out;
    }
    const entries = Object.entries(value);
    if (entries.length === 0)
        out.set(prefix || "(root)", {});
    for (const [key, child] of entries) {
        collectLeaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
}
/** Fields a hand edit is most likely to change; show these first when the list is truncated. */
function priority(path) {
    return path === "discovery.paths" ||
        path === "project.name" ||
        path === "project.version" ||
        path.endsWith(".enabledStacks")
        ? 0
        : 1;
}
/** Compares leaf values (arrays included) so whitespace or key order never counts as a reset. */
export function projectConfigChanges(before, after) {
    const oldLeaves = collectLeaves(before, "", new Map());
    const newLeaves = collectLeaves(after, "", new Map());
    const paths = new Set([...oldLeaves.keys(), ...newLeaves.keys()]);
    return [...paths]
        .filter((path) => JSON.stringify(oldLeaves.get(path)) !== JSON.stringify(newLeaves.get(path)))
        .sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
        .map((path) => ({ path, before: oldLeaves.get(path), after: newLeaves.get(path) }));
}
function renderValue(value) {
    if (value === undefined)
        return "(removed)";
    if (typeof value === "string")
        return value;
    if (Array.isArray(value)) {
        return `[${value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ")}]`;
    }
    return JSON.stringify(value) ?? String(value);
}
/** Short, readable list of what --force changed; the backup keeps the full picture. */
export function formatProjectConfigChanges(changes, limit = 8) {
    const lines = changes
        .slice(0, limit)
        .map(({ path, before, after }) => `${path}: ${renderValue(before)} -> ${renderValue(after)}`);
    if (changes.length > limit) {
        lines.push(`... and ${changes.length - limit} more keys (see the .bak file)`);
    }
    return lines;
}
/** Saves the raw file before --force replaces it; the path is reported to the user. */
export function backupProjectJson(projectJsonPath, existingContent) {
    const backupPath = `${projectJsonPath}.bak`;
    writeTextFileAtomic(backupPath, existingContent ?? readFileSync(projectJsonPath, "utf-8"));
    return backupPath;
}
