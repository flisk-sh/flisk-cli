/**
 * How an app gets to its users: the Zachman board, the listing kit and the channel grid behind
 * `flisk distribute`.
 *
 * Everything here reads and writes local files only. Nothing submits a listing, calls a marketplace
 * or a cloud API, or deploys. Output is deterministic: the same project gives the same board, kit
 * and grid.
 *
 * The implementation lives in ./distribution/, split by concept: the channel catalog
 * (channels.ts), the distribution.json pipeline (file.ts), source inspection (tools.ts), and the
 * board, status grid and kit renderers (board.ts, status.ts, kit.ts).
 */
export type { Board, BoardCell, BoardColumn, BoardPerspective, BoardRow, } from "./distribution/board.js";
export { BOARD_COLUMNS, BOARD_ROWS, buildBoard, formatBoard } from "./distribution/board.js";
export type { Channel, ChannelEntry, ChannelStatus, DistributionApp, DistributionFile, } from "./distribution/channels.js";
export { CHANNEL_STATUSES, CHANNELS, DISTRIBUTION_FILE, OPENAI_LONG_DESCRIPTION_LIMIT, OPENAI_NAME_LIMIT, OPENAI_SHORT_DESCRIPTION_LIMIT, PRODUCT_HUNT_DESCRIPTION_LIMIT, REGISTRY_DESCRIPTION_LIMIT, STATUS_ICONS, TAGLINE_LIMIT, } from "./distribution/channels.js";
export { createInitialDistribution, distributionWarnings, mergeDistribution, readDistributionFile, } from "./distribution/file.js";
export type { Kit, KitFile } from "./distribution/kit.js";
export { buildKit, slugify, URL_PLACEHOLDER, writeKit } from "./distribution/kit.js";
export type { StatusGrid } from "./distribution/status.js";
export { buildStatusGrid, formatStatusGrid } from "./distribution/status.js";
export { isMcpResource, readToolsAndPrompts } from "./distribution/tools.js";
