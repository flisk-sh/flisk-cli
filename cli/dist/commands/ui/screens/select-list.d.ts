import type React from "react";
import type { ScreenListProps } from "./types.js";
/** The picker state every list screen shares: a muted prompt line above the shared select input. */
export declare const ScreenSelectList: React.FC<ScreenListProps & {
    prompt: string;
}>;
