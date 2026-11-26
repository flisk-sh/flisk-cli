import type { ResourceType } from "./app-types.js";
import type { ResourceConfig } from "./resources.js";
export interface DiscoveredResource {
    name: string;
    path: string;
    configPath: string;
    config?: ResourceConfig;
    stack?: string;
    port?: number;
    type?: ResourceType;
}
/** A field a sibling `service.local.json` may change for a local-process run. */
export type LocalOverrideField = "port" | "enabled" | "command" | "env";
/** One active `service.local.json` field, as reported by the `--json` commands. */
export interface LocalOverride {
    service: string;
    field: LocalOverrideField;
}
export interface DiscoveredStack {
    name: string;
    description?: string;
    resources: DiscoveredResource[];
    resourceCount: number;
}
export interface DiscoveryProblem {
    path: string;
    reason: string;
}
export interface DiscoveryContext {
    resources: DiscoveredResource[];
    problems: DiscoveryProblem[];
    stacks: DiscoveredStack[];
    stackNames: string[];
    unassignedResources: DiscoveredResource[];
    resourcesByStack: Map<string, DiscoveredResource[]>;
}
