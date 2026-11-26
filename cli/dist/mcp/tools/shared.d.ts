export declare function names(value: unknown, field: string): string[];
export declare function optionalName(value: unknown, field: string): string | undefined;
/**
 * A name `flisk resource` can scaffold, checked with the CLI's own validator: lowercase letters,
 * numbers and hyphens, starting and ending with a letter or number, at most 63 characters and never a
 * Windows device name. The shared NAME pattern above also lets ".", "_" and uppercase through, so
 * the tool accepted names the command then refused (#5235).
 */
export declare function creatableResourceName(value: unknown): string;
/** A list of project-relative paths (used by config_verify's opt-in diffFiles). */
export declare function paths(value: unknown, field: string): string[];
/** A project name: the kebab-case rule the CLI's `--name` applies, so the spawned command cannot refuse it. */
export declare function optionalProjectName(value: unknown, field: string): string | undefined;
export declare function flag(value: unknown, field: string, fallback?: boolean): boolean;
/** One of a fixed set of values, such as a resource type or a template name. */
export declare function optionalChoice(value: unknown, field: string, choices: readonly string[]): string | undefined;
/** A file or directory path. A leading "-" is rejected so a positional path can never be read as a flag. */
export declare function optionalPath(value: unknown, field: string): string | undefined;
export declare function optionalPort(value: unknown, field: string): number | undefined;
export declare const OBJECT: (properties: Record<string, unknown>) => {
    type: string;
    properties: Record<string, unknown>;
    additionalProperties: boolean;
};
export declare const PROJECT_PATH: {
    type: string;
    description: string;
};
export declare function projectPath(value: unknown): string | undefined;
