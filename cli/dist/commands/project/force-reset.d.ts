/** One leaf of project.json that `project --force` is about to replace (#5477). */
export interface ProjectConfigChange {
    path: string;
    before: unknown;
    after: unknown;
}
/** Compares leaf values (arrays included) so whitespace or key order never counts as a reset. */
export declare function projectConfigChanges(before: unknown, after: unknown): ProjectConfigChange[];
/** Short, readable list of what --force changed; the backup keeps the full picture. */
export declare function formatProjectConfigChanges(changes: ProjectConfigChange[], limit?: number): string[];
/** Saves the raw file before --force replaces it; the path is reported to the user. */
export declare function backupProjectJson(projectJsonPath: string, existingContent?: string): string;
