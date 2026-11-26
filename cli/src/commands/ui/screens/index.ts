// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { TabId } from "../../../types/index.js";
import { configScreen } from "./config.js";
import { eventsScreen } from "./events.js";
import { filesScreen } from "./files.js";
import { overviewScreen } from "./overview.js";
import { resourcesScreen } from "./resources.js";
import type { TuiScreen } from "./types.js";

/** The TUI screen registry: one module per tab route, switched on by the shell. */
export const TUI_SCREENS: Record<TabId, TuiScreen> = {
  overview: overviewScreen,
  resources: resourcesScreen,
  events: eventsScreen,
  files: filesScreen,
  config: configScreen,
};
