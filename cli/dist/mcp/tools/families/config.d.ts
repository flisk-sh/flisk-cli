/**
 * The config family: the generated-master-file commands (`config_verify`, `config_explain`, `config_regenerate`).
 * Each tool's arguments are declared once in an argSpec table bound to the command's generated spec.
 */
/** The `config_verify` tool's arguments, bound to the `flisk config verify` spec. */
export declare const configVerifyArgs: import("../../spec-args.js").ArgSpec;
/** `flisk config verify --json`, with a `--diff=<file>` for each drifted file the caller asks to see. */
export declare function buildConfigVerifyArgs(args?: Record<string, unknown>): string[];
export declare function summarizeConfigVerify(data: unknown): string | undefined;
/** The `config_explain` tool's arguments, bound to the `flisk config explain` spec. */
export declare const configExplainArgs: import("../../spec-args.js").ArgSpec;
/** `flisk config explain <file> --json`; `file` is the one required argument. */
export declare function buildConfigExplainArgs(args: Record<string, unknown>): string[];
/** The `config_regenerate` tool's arguments, bound to the `flisk config regenerate` spec. */
export declare const configRegenerateArgs: import("../../spec-args.js").ArgSpec;
/**
 * `flisk config regenerate`, a dry run unless `dryRun` is explicitly false: a real run rewrites the generated master files
 * from .flisk/project.json and discards any hand edits in them.
 */
export declare function buildConfigRegenerateArgs(args: Record<string, unknown>): string[];
