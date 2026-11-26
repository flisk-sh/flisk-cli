import type { DiscoveredResource } from "../../types/index.js";
import { type DistributionFile } from "./channels.js";
export interface KitFile {
    path: string;
    content: string;
}
export interface Kit {
    resource: string;
    files: KitFile[];
    warnings: string[];
}
export declare const URL_PLACEHOLDER = "https://REPLACE-ME.example.com/mcp";
/** A listing slug: lowercase letters, digits and single dashes. */
export declare function slugify(name: string): string;
export declare function buildKit(resource: DiscoveredResource, dist: DistributionFile | null): Kit;
/** Writes the kit under outDir. Refuses when any file exists, unless isForced. Returns the written paths. */
export declare function writeKit(kit: Kit, outDir: string, isForced: boolean): string[];
