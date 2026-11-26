import type { McpToolResult } from "../../server.js";
/**
 * The project family: the project's own record (`project_info`, `project_templates`) and the commands that write into a
 * directory (`project_init`, `project_import`) or back out of it (`project_eject`). Each tool's arguments are
 * declared once in an argSpec table bound to the command's generated spec.
 */
/** Cloning a starter repository can outlast the default two minutes. */
export declare const PROJECT_INIT_TIMEOUT_MS = 300000;
/** `flisk import` fetches flisk-import through npx first, which can outlast the default two minutes too. */
export declare const IMPORT_TIMEOUT_MS = 300000;
/** The `project_info` tool's arguments, bound to the `flisk projects` spec. */
export declare const projectInfoArgs: import("../../spec-args.js").ArgSpec;
/** `flisk projects --json`: the project at projectPath (or the server's directory). */
export declare function buildProjectInfoArgs(): string[];
/** `project_templates` is data the server already has; no CLI run. */
export declare const projectTemplatesRun: () => () => Promise<McpToolResult>;
/** The `project_init` tool's arguments, bound to the `flisk project` spec. */
export declare const projectInitArgs: import("../../spec-args.js").ArgSpec;
/** `flisk project [template] --yes`. Never `--force`, which overwrites an existing .flisk/project.json. */
export declare function buildProjectInitArgs(args: Record<string, unknown>): string[];
/** The `project_eject` tool's arguments, bound to the `flisk eject` spec. */
export declare const projectEjectArgs: import("../../spec-args.js").ArgSpec;
/**
 * `flisk eject --json`. A real run writes EJECTED.md into the project, so it is refused unless `confirm` is true; a dry run
 * changes nothing and needs no confirmation.
 */
export declare function buildProjectEjectArgs(args: Record<string, unknown>): string[];
/** The `project_import` tool's arguments, bound to the `flisk import` spec. */
export declare const projectImportArgs: import("../../spec-args.js").ArgSpec;
/**
 * `flisk import [dir] --json`, which writes without a prompt unless `dryRun` is set. `dir` comes before the flags. `force`
 * overwrites an existing service.json, so a real run with it is refused unless `confirm` is true (a dry run changes nothing).
 */
export declare function buildProjectImportArgs(args: Record<string, unknown>): string[];
