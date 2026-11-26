import type { DiscoveredResource } from "../../types/index.js";
/**
 * Runs before anything starts (also under --dry-run, like the drift gate): duplicate service names, circular
 * dependsOn and invalid ports exit with 1 and say which file, which field, and how to fix it.
 */
export declare function enforceServiceConfigGate(projectRoot: string, options?: {
    onInvalid?: (message: string) => void;
    onWarning?: (message: string) => void;
    resources?: DiscoveredResource[];
}, exit?: (code: number) => never): void;
