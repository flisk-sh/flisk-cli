import type { CommandArgumentSpec, CommandOptionSpec, CommandSpec } from "../commands/command-specs.js";
import { flag, names, optionalChoice, optionalName, optionalPath, optionalPort, optionalProjectName } from "./tools/shared.js";
export { flag, names, optionalChoice, optionalName, optionalPath, optionalPort, optionalProjectName, };
/** The spec of the command at `path` (for example ["config", "verify"]), or a failure if none exists. */
export declare function specOf(path: readonly string[]): CommandSpec;
/** The shared `projectPath` schema property every project-bound tool advertises. */
export declare const PROJECT_PATH: Record<string, unknown>;
export interface SpecOptionFlags {
    /** The long flag, for example "--problems-only". */
    long: string;
    /** The Commander attribute the flag writes: "ping" for "--no-ping", "envFile" for "--env-file". */
    attribute: string;
    /** A "--no-*" flag: it stores false under attribute. */
    negated: boolean;
    /** The flag takes a value (<v> or [v]). */
    takesValue: boolean;
    /** The value may be passed more than once (<v...>). */
    variadic: boolean;
}
/** Parse a Commander flags string such as "-s, --service <names...>" or "--no-ping". */
export declare function parseOptionFlags(flags: string): SpecOptionFlags;
/**
 * How a bound argument's value is checked before it is emitted.
 *
 *   boolean   a flag; emitted only when the resolved value equals `when`
 *   name      a service or stack name (letters, digits, ".", "_", "-"; never a leading "-")
 *   names     an array of names; emitted once per element (repeated --flag= or positionals)
 *   strings   an array kept as given, for a variadic command after --
 *   path      a non-empty path that does not start with "-"
 *   port      an integer from 1 to 65535
 *   int       an integer within `min`/`max` when set
 *   number    a number; a non-number falls back to `default`
 *   duration  a duration string such as 30s, 5m or 1h
 *   cursor    a non-negative integer cursor, as a string or number
 *   choice    one of `choices` (or the spec element's own argChoices)
 *   raw       no shape check; left to `coerce`
 */
export type ValueKind = "boolean" | "name" | "names" | "strings" | "path" | "port" | "int" | "number" | "duration" | "cursor" | "choice" | "raw";
export interface ArgFields {
    /** The MCP argument name; default the option's attribute or the argument's name. */
    arg?: string;
    /**
     * The value kind. Flag-only options default to "boolean", variadic options to "names" and
     * a single positional to "name"; a value-taking option or a variadic positional names one.
     */
    as?: ValueKind;
    /** "choice": the accepted values; also the schema's enum. Default the spec element's argChoices. */
    choices?: readonly string[];
    /** Error out when the argument is omitted, with "<arg> is required" or requiredMessage. */
    required?: boolean;
    /** Keep a required argument out of schema.required (the runtime check stays). Default true. */
    schemaRequired?: boolean;
    /** Error text when a required argument is omitted or a names/strings list runs short. */
    requiredMessage?: string;
    /** Suggestions attached to required and invalid-value errors. */
    suggestions?: string[];
    /** Error text for a present-but-invalid value (default: the kind's own message). */
    invalid?: string;
    /** Turn a valid value into the emitted one (for example resolve a tool name to its catalog id). */
    coerce?: (value: unknown, arg: string) => unknown;
    /**
     * Boolean flags: emit when the resolved value equals this. Default follows the flag's
     * spelling: an argument named like a "--no-*" flag's attribute emits when false
     * (agentSkills: false -> --no-agent-skills); any other binding emits when true.
     */
    when?: boolean;
    /** The value used when the argument is omitted (boolean flags: also the flag's fallback). */
    default?: unknown;
    /** "int" bounds; they also land in the schema as minimum/maximum. */
    min?: number;
    max?: number;
    /** Minimum list length for "names" and "strings". */
    minItems?: number;
    /** Schema description override; null drops the spec's own. */
    description?: string | null;
    /** Extra schema fields merged into the property, or false for no schema property at all. */
    schema?: Record<string, unknown> | false;
}
export interface OptionRow extends ArgFields {
    readonly kind: "option";
    /** The spec option's long flag, for example "--problems-only". */
    readonly flag: string;
}
export interface ArgumentRow extends ArgFields {
    readonly kind: "argument";
    /** The spec argument's name, for example "stack-name" or "command". */
    readonly argument: string;
}
/** An argument only the MCP layer knows (confirm, waitSeconds), with its full schema property. */
export interface McpRow {
    readonly kind: "mcp";
    readonly arg: string;
    readonly schema: Record<string, unknown>;
}
/** A rule over several arguments (a confirm gate, a combination check), run where the row sits. */
export interface GuardRow {
    readonly kind: "guard";
    readonly check: (args: Record<string, unknown>) => void;
}
/** A table row: a literal token, a bound flag or positional, an MCP-only argument, or a guard. */
export type ArgRow = string | OptionRow | ArgumentRow | McpRow | GuardRow;
/** Bind an MCP argument to a spec option by its long flag. */
export declare function option(flag: string, fields?: ArgFields): OptionRow;
/** Bind an MCP argument to a spec argument (a positional value) by its name. */
export declare function positional(argument: string, fields?: ArgFields): ArgumentRow;
/** An argument that exists only on the MCP side and is never emitted to the CLI. */
export declare function mcpArg(arg: string, schema: Record<string, unknown>): McpRow;
/** A check over the whole argument object, run where the row sits in the table. */
export declare function guard(check: (args: Record<string, unknown>) => void): GuardRow;
/** A bound row with its spec element resolved: the argument name, the value kind, the flag or argument. */
export interface ResolvedBinding {
    readonly row: OptionRow | ArgumentRow;
    readonly arg: string;
    readonly as: ValueKind;
    readonly option?: {
        spec: CommandOptionSpec;
        flags: SpecOptionFlags;
    };
    readonly argument?: CommandArgumentSpec;
}
/** Match one row against its spec element, or fail with the command it should have been on. */
export declare function resolveRow(spec: CommandSpec, row: OptionRow | ArgumentRow): ResolvedBinding;
/** The argv a table emits for `args`: the command path plus each row's emission, in row order. */
export declare function buildArgs(spec: CommandSpec, rows: readonly ArgRow[], args: Record<string, unknown>): string[];
/**
 * The tool's inputSchema, generated from the same rows `build` reads. `projectPath: true`
 * adds the shared project-root property first; pass an object to give a tool its own text.
 */
export declare function inputSchema(spec: CommandSpec, rows: readonly ArgRow[], options?: {
    projectPath?: boolean | Record<string, unknown>;
}): Record<string, unknown>;
export interface ArgSpec {
    /** The command this table's argv runs. */
    readonly spec: CommandSpec;
    /** The declared rows (literals, bindings, MCP-only arguments and guards), for tests. */
    readonly rows: readonly ArgRow[];
    /** The bound rows resolved against the spec, for tests that sample arguments per kind. */
    readonly bindings: readonly ResolvedBinding[];
    /** Validated `flisk <args>` for the child process: the command path plus each row's emission. */
    build(args: Record<string, unknown>): string[];
    /** The tool's inputSchema, generated from the same rows. */
    inputSchema(options?: {
        projectPath?: boolean | Record<string, unknown>;
    }): Record<string, unknown>;
}
/**
 * Declare one tool's CLI arguments, bound to the spec of the command they run. Rows are
 * resolved when the module loads, so a flag or argument the command does not declare fails
 * on import - a programming error, not a tool error.
 */
export declare function argSpec(path: readonly string[], rows: readonly ArgRow[]): ArgSpec;
