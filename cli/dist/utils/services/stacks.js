// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { formatCount } from "../formatting.js";
import { discoverResources, discoverResourcesFromRoot } from "./discover.js";
/**
 * Unique, sorted `stack` values across discovered service.json files under `projectRoot`.
 * Tilt's discovery groups services by this same field (see flisk-cli-extensions
 * discovery_orchestrator.star), so these are the names that must appear in a
 * stack's `services` list in .flisk/project.json for that group to be enabled.
 */
export function discoverStackNames(projectRoot, resources) {
    const resourcesToScan = resources ?? discoverResourcesFromRoot(projectRoot);
    return getAllStacks(resourcesToScan);
}
export function getAllStacks(resources) {
    const resourcesToScan = resources || discoverResources();
    const stacks = new Set();
    for (const resource of resourcesToScan) {
        if (resource.stack) {
            stacks.add(resource.stack);
        }
    }
    return Array.from(stacks).sort((a, b) => a.localeCompare(b));
}
export function discoverStacks(resources = discoverResources()) {
    const stackMap = new Map();
    for (const resource of resources) {
        if (resource.stack) {
            const stackResources = stackMap.get(resource.stack);
            if (stackResources) {
                stackResources.push(resource);
            }
            else {
                stackMap.set(resource.stack, [resource]);
            }
        }
    }
    const stacks = [];
    for (const [name, stackResources] of stackMap) {
        stacks.push({
            name,
            description: formatCount(stackResources.length, "resource"),
            resources: stackResources,
            resourceCount: stackResources.length,
        });
    }
    return stacks.sort((a, b) => a.name.localeCompare(b.name));
}
export function getResourcesForStack(stackName, resources) {
    const allResources = resources ?? discoverResources();
    return allResources.filter((r) => r.stack === stackName);
}
export function stackExists(stackName, resources) {
    const resourcesToSearch = resources ?? discoverResources();
    return resourcesToSearch.some((resource) => resource.stack === stackName);
}
