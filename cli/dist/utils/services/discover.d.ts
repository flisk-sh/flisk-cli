import type { DiscoveredResource, DiscoveryProblem } from "../../types/index.js";
import { FliskError } from "../errors.js";
export declare function discoverServiceManifestPaths(projectRoot: string): string[];
export declare class InvalidServiceJsonError extends FliskError {
    readonly reason: string;
    readonly code: "CONFIG_INVALID";
    constructor(reason: string, suggestions?: string[]);
}
/**
 * Invalidate cached `discoverResourcesWithProblems` results.
 *
 * Shares the lifetime and mutation contract of the discovery context cache:
 * `clearDiscoveryCache()` in discovery-context.ts calls this, so any command that
 * creates, mutates, or removes service manifests (`service.json`) keeps later
 * discovery in the same process observing the updated filesystem state.
 *
 * @param projectRoot Optional project root to invalidate. If omitted, all cached results are cleared.
 */
export declare function clearDiscoveryResultCache(projectRoot?: string): void;
export declare function discoverResourcesWithProblems(projectRoot: string): {
    resources: DiscoveredResource[];
    problems: DiscoveryProblem[];
};
export declare function discoverResourcesFromRoot(projectRoot: string): DiscoveredResource[];
export declare function discoverResources(): DiscoveredResource[];
export declare function discoverResourcesStrict(discovered?: {
    resources: DiscoveredResource[];
    problems: DiscoveryProblem[];
}): DiscoveredResource[];
