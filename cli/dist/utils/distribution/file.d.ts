import type { DiscoveredResource } from "../../types/index.js";
import { type DistributionFile } from "./channels.js";
/** Reads distribution.json, or null when the project has none. Throws a FliskError when it is malformed. */
export declare function readDistributionFile(projectRoot: string): DistributionFile | null;
/** Warnings about a distribution.json that loads but looks wrong, such as an unknown channel id. */
export declare function distributionWarnings(dist: DistributionFile | null): string[];
/** Adds the missing apps and channels to an existing distribution.json and keeps every entry already there. */
export declare function mergeDistribution(existing: DistributionFile, resources: DiscoveredResource[]): DistributionFile;
/** The empty distribution.json for these resources: every channel todo, MCP-only channels n/a for other types. */
export declare function createInitialDistribution(resources: DiscoveredResource[]): DistributionFile;
