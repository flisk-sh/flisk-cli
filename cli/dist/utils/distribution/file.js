// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The distribution.json pipeline for `flisk distribute`: read the file, warn about entries that
 * look wrong, merge in new apps and channels, and create the initial file for a project.
 */
import fs from "node:fs";
import path from "node:path";
import { FliskError } from "../errors.js";
import { CHANNEL_STATUSES, CHANNELS, DISTRIBUTION_FILE, } from "./channels.js";
import { isMcpResource } from "./tools.js";
/** Reads distribution.json, or null when the project has none. Throws a FliskError when it is malformed. */
export function readDistributionFile(projectRoot) {
    const file = path.join(projectRoot, DISTRIBUTION_FILE);
    if (!fs.existsSync(file))
        return null;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    }
    catch (err) {
        throw new FliskError(`${DISTRIBUTION_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, ["Fix the file, or move it away and run flisk distribute status --init"]);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new FliskError(`${DISTRIBUTION_FILE} must hold a JSON object`, [
            "Run flisk distribute status --init --force to write a fresh one",
        ]);
    }
    const data = parsed;
    const apps = data.apps ?? {};
    if (typeof apps !== "object" || Array.isArray(apps)) {
        throw new FliskError(`${DISTRIBUTION_FILE}: "apps" must be an object keyed by resource name`, [
            'Write it as { "apps": { "<resource>": { "channels": {} } } }',
        ]);
    }
    for (const [appName, app] of Object.entries(apps)) {
        if (typeof app !== "object" || app === null || Array.isArray(app)) {
            throw new FliskError(`${DISTRIBUTION_FILE}: app ${appName} must be an object`, [
                'Write it as { "channels": { "<channel>": { "status": "todo" } } }',
            ]);
        }
        const channels = app.channels ?? {};
        if (typeof channels !== "object" || channels === null || Array.isArray(channels)) {
            throw new FliskError(`${DISTRIBUTION_FILE}: ${appName} "channels" must be an object keyed by channel id`, [`Channel ids: ${CHANNELS.map((c) => c.id).join(", ")}`]);
        }
        for (const [channel, entry] of Object.entries(channels)) {
            if (!CHANNEL_STATUSES.includes(entry?.status)) {
                throw new FliskError(`${DISTRIBUTION_FILE}: ${appName} / ${channel} has status ${JSON.stringify(entry?.status)}`, [`Use one of: ${CHANNEL_STATUSES.join(", ")}`]);
            }
        }
    }
    return { ...data, schemaVersion: 1, apps };
}
/** Warnings about a distribution.json that loads but looks wrong, such as an unknown channel id. */
export function distributionWarnings(dist) {
    if (!dist)
        return [];
    const known = new Set(CHANNELS.map((c) => c.id));
    const warnings = [];
    for (const appName of Object.keys(dist.apps).sort((a, b) => a.localeCompare(b))) {
        for (const id of Object.keys(dist.apps[appName]?.channels ?? {}).sort((a, b) => a.localeCompare(b))) {
            if (!known.has(id)) {
                warnings.push(`${DISTRIBUTION_FILE}: ${appName} has unknown channel "${id}". Known channels: ${[...known].join(", ")}.`);
            }
        }
    }
    return warnings;
}
/** Adds the missing apps and channels to an existing distribution.json and keeps every entry already there. */
export function mergeDistribution(existing, resources) {
    const fresh = createInitialDistribution(resources);
    const apps = { ...existing.apps };
    for (const [name, freshApp] of Object.entries(fresh.apps)) {
        const old = apps[name];
        apps[name] = old
            ? { ...old, channels: { ...freshApp.channels, ...(old.channels ?? {}) } }
            : freshApp;
    }
    const sorted = Object.fromEntries(Object.keys(apps)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, apps[k]]));
    return { ...existing, schemaVersion: 1, apps: sorted };
}
/** The empty distribution.json for these resources: every channel todo, MCP-only channels n/a for other types. */
export function createInitialDistribution(resources) {
    const apps = {};
    for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
        const channels = {};
        for (const channel of CHANNELS) {
            channels[channel.id] = {
                status: channel.isMcpOnly && !isMcpResource(resource) ? "n/a" : "todo",
            };
        }
        apps[resource.name] = { name: resource.name, tagline: "", description: "", channels };
    }
    return { schemaVersion: 1, apps };
}
