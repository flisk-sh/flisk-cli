import type { TabId } from "../../../types/index.js";
import type { TuiScreen } from "./types.js";
/** The TUI screen registry: one module per tab route, switched on by the shell. */
export declare const TUI_SCREENS: Record<TabId, TuiScreen>;
