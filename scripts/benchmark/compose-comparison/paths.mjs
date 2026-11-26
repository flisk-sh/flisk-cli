// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Shared filesystem locations for the compose-comparison benchmark modules.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Repository root (three levels up from scripts/benchmark/compose-comparison/). */
export const REPO_ROOT = resolve(MODULE_DIR, "../../..");

/** Compiled Flisk CLI entrypoint measured by the flisk trials. */
export const CLI_PATH = resolve(REPO_ROOT, "cli/dist/cli.js");
