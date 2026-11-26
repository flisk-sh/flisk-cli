/**
 * The channel grid behind `flisk distribute status`: one row per channel, one column per app,
 * each cell the status icon for that listing.
 */
import { type ChannelEntry, type DistributionFile } from "./channels.js";
export interface StatusGrid {
    apps: string[];
    channels: {
        id: string;
        name: string;
        cells: Record<string, ChannelEntry>;
    }[];
}
export declare function buildStatusGrid(dist: DistributionFile): StatusGrid;
export declare function formatStatusGrid(grid: StatusGrid): string;
