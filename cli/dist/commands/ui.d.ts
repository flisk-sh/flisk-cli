import { Command } from "commander";
import type React from "react";
import type { LoadingScreenProps } from "../types/index.js";
import { agentRouteOf } from "./ui/agent-route.js";
import { createHelpHint } from "./ui/help-hint.js";
export { agentRouteOf, createHelpHint };
/** Footer filter badge text in ASCII or Unicode mode. */
export declare function enabledFilterLabel(showEnabledOnly: boolean, ascii: boolean): string;
export declare const LoadingScreen: React.FC<LoadingScreenProps>;
export declare const TUIApp: React.FC<{
    animated?: boolean;
}>;
export declare const uiCommand: Command;
