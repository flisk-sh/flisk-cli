import type { DiscoveredResource, DiscoveredStack } from "../../types/index.js";
/**
 * Unique, sorted `stack` values across discovered service.json files under `projectRoot`.
 * Tilt's discovery groups services by this same field (see flisk-cli-extensions
 * discovery_orchestrator.star), so these are the names that must appear in a
 * stack's `services` list in .flisk/project.json for that group to be enabled.
 */
export declare function discoverStackNames(projectRoot: string, resources?: DiscoveredResource[]): string[];
export declare function getAllStacks(resources?: DiscoveredResource[]): string[];
export declare function discoverStacks(resources?: DiscoveredResource[]): DiscoveredStack[];
export declare function getResourcesForStack(stackName: string, resources?: DiscoveredResource[]): DiscoveredResource[];
export declare function stackExists(stackName: string, resources?: DiscoveredResource[]): boolean;
