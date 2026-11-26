import { Command } from "commander";
import { cloneProjectTemplate, enableDiscoveredStacks, lastLine, writeDefaultProjectConfig } from "./project/clone.js";
import { ACTION_WORD_HINTS, actionWordHint, exitUnknownTemplate, formatProjectPaths, type ProjectShell, printTemplateCatalog } from "./project/template-catalog.js";
export type { ProjectShell };
export { ACTION_WORD_HINTS, actionWordHint, cloneProjectTemplate, enableDiscoveredStacks, exitUnknownTemplate, formatProjectPaths, lastLine, printTemplateCatalog, writeDefaultProjectConfig, };
export declare const projectCommand: Command;
