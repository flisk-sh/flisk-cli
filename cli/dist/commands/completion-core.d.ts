/**
 * The shared completions-table core.
 *
 * `commands/completion-candidates.ts` describes what the shells suggest; this module turns that
 * table into the fragments the four shell renderers share: the flattened command entries, the
 * rows grouped the way the scripts offer them, and the emit helpers. A new command, a new flag or
 * a new positional kind lands in every renderer through `buildCompletionTable`, so the renderers
 * hold only their shell's syntax.
 */
import type { CompletionCandidates, CompletionCommand, CompletionOption, CompletionPositional, TypeDependentValues } from "./completion-candidates.js";
/** A command with the path the user types it under (`config verify`). */
export interface CommandEntry {
    /** The path the user types, for example `config verify`. */
    path: string;
    /** The word at this level. */
    name: string;
    /** The alternative words the CLI accepts. */
    aliases: string[];
    description: string;
    options: CompletionOption[];
    /** The sub-commands of this command. */
    subcommands: CommandEntry[];
    /** The path of the parent command, empty for a top-level command. */
    parent: string;
    /** What the command's positional argument completes. */
    positional?: CompletionPositional;
    /** The name of the positional argument of the command, when it takes one. */
    argument?: string;
    /** True when the positional argument takes many values. */
    variadic?: boolean;
    /** The values of the flags of this command, when the command accepts another set. */
    optionValues?: Record<string, string[]>;
    /** The fixed values of the positional argument, when it is not a project value. */
    positionalValues?: string[];
}
export declare function toEntries(commands: CompletionCommand[], parent?: string): CommandEntry[];
/** Every command and sub-command, flattened. */
export declare function flatten(entries: CommandEntry[]): CommandEntry[];
/** The words that start a command: the name and every alias. */
export declare function commandWords(entries: CommandEntry[]): string[];
/** A short description, without the characters the shell literals cannot hold. */
export declare function shortDescription(description: string): string;
export declare function flagList(options: readonly CompletionOption[]): string;
/** The values of a flag, for the command that is being completed. */
export declare function valuesOf(flag: string, candidates: CompletionCandidates, entry?: CommandEntry): string[] | undefined;
/** The values of a flag for each `--type` of the command line, with the fallback merged in. */
export interface TypeValueArm {
    /** The `--type` values the arm matches. The empty string means "no `--type`". */
    types: string[];
    /** The values the flag offers for those types. */
    values: string[];
}
export declare function typeValueArms(values: TypeDependentValues): TypeValueArm[];
/** The name of the variable that holds the `--type` of the command line. */
export declare const TYPE_VARIABLE = "flisk_type";
/** The condition of one `--type` arm, in the syntax of bash and zsh. */
export declare function shellTypeCondition(types: string[]): string;
/** The stacks of the current project, read from the machine-readable CLI output. */
export declare const JSON_STACKS = "flisk stacks --json 2>/dev/null | grep -o '\"name\":\"[^\"]*\"' | sed 's/\"name\":\"//;s/\"$//'";
/** The resources of the current project, read from the machine-readable CLI output. */
export declare const JSON_RESOURCES = "flisk resources --json 2>/dev/null | grep -o '\"name\":\"[^\"]*\"' | sed 's/\"name\":\"//;s/\"$//'";
/** The flags whose values come from the current project: the stacks and the resources. */
export declare const PROJECT_VALUE_FLAGS: ReadonlySet<string>;
/** One alias of a top-level command, with the command it runs. */
export interface AliasRow {
    /** The word the user types. */
    alias: string;
    /** The command the alias stands for. */
    entry: CommandEntry;
}
/** One sub-command of a top-level command. */
export interface SubcommandRow {
    /** The parent command. */
    parent: CommandEntry;
    /** The sub-command under it. */
    subcommand: CommandEntry;
}
/** The values of one flag of one command, when the command accepts its own set. */
export interface CommandValueRow {
    /** The row key the scripts match: the command path and the flag (`config verify --scope`). */
    key: string;
    /** The flag alone. */
    flag: string;
    /** The values the flag offers for that command. */
    values: string[];
}
/** The values of one flag that depend on the `--type` of the command line. */
export interface TypeValueRow {
    /** The flag the row completes. */
    flag: string;
    /** The values of the flag, per `--type`. */
    values: TypeDependentValues;
    /** The arms of the values, with the fallback merged in. */
    arms: TypeValueArm[];
}
/**
 * The rows of the candidates table, grouped the way the shell scripts offer them.
 *
 * Every group is computed once here: a renderer that filtered the same way on its own would
 * repeat the rule in three other places, and a new positional kind would land in only one shell.
 */
export interface CompletionTable {
    /** The top-level command entries. */
    entries: CommandEntry[];
    /** Every command and sub-command, flattened. */
    flat: CommandEntry[];
    /** The words that start a top-level command: the names and every alias. */
    words: string[];
    /** The aliases of the top-level commands. */
    aliasRows: AliasRow[];
    /** The sub-commands of the top-level commands, each with its parent. */
    subcommandRows: SubcommandRow[];
    /** The top-level entries that have sub-commands. */
    withSubcommands: CommandEntry[];
    /** The top-level entries that offer flags. */
    topOptionEntries: CommandEntry[];
    /** The flattened entries that offer flags. */
    optionEntries: CommandEntry[];
    /** The flattened sub-command entries that offer flags. */
    subOptionEntries: CommandEntry[];
    /** The flattened sub-command entries. */
    subEntries: CommandEntry[];
    /** The top-level entries whose positional argument completes. */
    topPositionalEntries: CommandEntry[];
    /** The flattened entries whose positional argument completes. */
    positionalEntries: CommandEntry[];
    /** The flattened sub-command entries whose positional argument completes. */
    subPositionalEntries: CommandEntry[];
    /** The flattened entries whose positional argument completes stacks. */
    stackEntries: CommandEntry[];
    /** The flattened entries whose positional argument completes resources. */
    resourceEntries: CommandEntry[];
    /** The flattened entries whose positional argument completes command names. */
    commandNameEntries: CommandEntry[];
    /** The flattened entries whose positional argument completes a fixed list. */
    positionalValueEntries: CommandEntry[];
    /** The values of the flags of a command, when the command accepts its own set. */
    commandValueRows: CommandValueRow[];
    /** The values of the flags that take the same fixed list everywhere. */
    valueRows: {
        flag: string;
        values: string[];
    }[];
    /** The values of the flags that depend on the `--type` of the command line. */
    typeValueRows: TypeValueRow[];
}
/**
 * Builds the rows the four renderers share from the candidates table.
 *
 * The renderers keep their own syntax; everything they each recomputed (the flattening, the
 * groupings by flags, positionals and values, the `--type` arms) is computed once here.
 */
export declare function buildCompletionTable(candidates: CompletionCandidates): CompletionTable;
