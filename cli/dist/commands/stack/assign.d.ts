import type { DiscoveredResource } from "../../types/index.js";
export type StackResourceConfig = {
    [key: string]: unknown;
    appName?: string;
    stack?: string;
};
export declare function parseStackResourceConfig(content: string, configPath: string): StackResourceConfig;
/** What the write-back changed: the manifests it reports, and every path that holds new content. */
export interface StackAssignment {
    assigned: {
        name: string;
        configPath: string;
    }[];
    changedPaths: Set<string>;
}
/**
 * Write the stack field onto each selected service.json, relocating the folder
 * when a planned move takes `services/<stack>/<name>` to a different stack's
 * folder, then regenerate the stack wiring when anything relocated.
 */
export declare function writeStackAssignments(args: {
    /** Canonical service.json paths to update, in request order. */
    selectedPaths: string[];
    /** Old service.json path -> new service.json path for resources that relocate folders. */
    relocations: Map<string, string>;
    /** The discovered resources, for display names and previous stacks. */
    resources: DiscoveredResource[];
    projectRoot: string;
    /** The stack to store, or null under --remove (the field is deleted instead). */
    targetStack: string | null;
    remove?: boolean;
    /** Runs after a relocation; defaults to the generated-config regeneration the command needs. */
    regenerate?: (projectRoot: string) => Promise<unknown>;
}): Promise<StackAssignment>;
