import { configScreen } from "./config.js";
import { eventsScreen } from "./events.js";
import { filesScreen } from "./files.js";
import { overviewScreen } from "./overview.js";
import { resourcesScreen } from "./resources.js";
/** The TUI screen registry: one module per tab route, switched on by the shell. */
export const TUI_SCREENS = {
    overview: overviewScreen,
    resources: resourcesScreen,
    events: eventsScreen,
    files: filesScreen,
    config: configScreen,
};
