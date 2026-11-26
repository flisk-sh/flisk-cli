export declare const ACTION_WORD_HINTS: Readonly<Record<string, string>>;
/** Looks up an action word's hint; own keys only, so `constructor` and `__proto__` never match. */
export declare function actionWordHint(word: string): string | undefined;
/** Refuses an unknown starter name: prints the error and the catalog, then exits non-zero. */
export declare function exitUnknownTemplate(templateName: string): never;
export type ProjectShell = "auto" | "posix" | "cmd" | "cmd-delayed" | "powershell";
/** Formats the created folder label and shell-safe `cd` next-step command(s) for the current OS and shell. */
export declare function formatProjectPaths(dirName: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, shell?: ProjectShell, workingDir?: string): {
    displayDirWithSlash: string;
    cdTarget: string;
    cdCommands: string[];
};
/**
 * Prints the template catalog: with `json`, the usual envelope with the templates in `data.templates` (the same rows
 * as the `project_templates` MCP tool); otherwise one block per template with its key, description, repo, needs and ref.
 */
export declare function printTemplateCatalog(json: boolean): void;
