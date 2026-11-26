// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
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
// Zachman board
export { BOARD_COLUMNS, BOARD_ROWS, buildBoard, formatBoard } from "./distribution/board.js";
// Channel catalog: statuses, icons, limits and the distribution.json types
export { CHANNEL_STATUSES, CHANNELS, DISTRIBUTION_FILE, OPENAI_LONG_DESCRIPTION_LIMIT, OPENAI_NAME_LIMIT, OPENAI_SHORT_DESCRIPTION_LIMIT, PRODUCT_HUNT_DESCRIPTION_LIMIT, REGISTRY_DESCRIPTION_LIMIT, STATUS_ICONS, TAGLINE_LIMIT, } from "./distribution/channels.js";
// distribution.json pipeline: read, warn, merge, create
export { createInitialDistribution, distributionWarnings, mergeDistribution, readDistributionFile, } from "./distribution/file.js";
// Listing kit
export { buildKit, slugify, URL_PLACEHOLDER, writeKit } from "./distribution/kit.js";
// Status grid
export { buildStatusGrid, formatStatusGrid } from "./distribution/status.js";
// Source inspection: resource kind, tools and prompts
export { isMcpResource, readToolsAndPrompts } from "./distribution/tools.js";
