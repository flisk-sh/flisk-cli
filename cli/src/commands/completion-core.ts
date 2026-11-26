// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The shared completions-table core.
 *
 * `commands/completion-candidates.ts` describes what the shells suggest; this module turns that
 * table into the fragments the four shell renderers share: the flattened command entries, the
 * rows grouped the way the scripts offer them, and the emit helpers. A new command, a new flag or
 * a new positional kind lands in every renderer through `buildCompletionTable`, so the renderers
 * hold only their shell's syntax.
 */
import type {
  CompletionCandidates,
  CompletionCommand,
  CompletionOption,
  CompletionPositional,
  TypeDependentValues,
} from "./completion-candidates.js";

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

export function toEntries(commands: CompletionCommand[], parent = ""): CommandEntry[] {
  return commands.map((command) => {
    const path = parent ? `${parent} ${command.name}` : command.name;
    return {
      path,
      name: command.name,
      aliases: command.aliases,
      description: command.description,
      options: command.options,
      subcommands: toEntries(command.subcommands, path),
      parent,
      ...(command.positional ? { positional: command.positional } : {}),
      ...(command.argument ? { argument: command.argument } : {}),
      ...(command.variadic ? { variadic: true } : {}),
      ...(command.optionValues ? { optionValues: command.optionValues } : {}),
      ...(command.positionalValues ? { positionalValues: command.positionalValues } : {}),
    };
  });
}

/** Every command and sub-command, flattened. */
export function flatten(entries: CommandEntry[]): CommandEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.subcommands)]);
}

/** The words that start a command: the name and every alias. */
export function commandWords(entries: CommandEntry[]): string[] {
  return entries.flatMap((entry) => [entry.name, ...entry.aliases]);
}

/** A short description, without the characters the shell literals cannot hold. */
export function shortDescription(description: string): string {
  const text = description.replace(/[[\]'":]/g, "").trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function flagList(options: readonly CompletionOption[]): string {
  return options.map((option) => option.flag).join(" ");
}

/** The values of a flag, for the command that is being completed. */
export function valuesOf(
  flag: string,
  candidates: CompletionCandidates,
  entry?: CommandEntry,
): string[] | undefined {
  return entry?.optionValues?.[flag] ?? candidates.values[flag];
}

/** The values of a flag for each `--type` of the command line, with the fallback merged in. */
export interface TypeValueArm {
  /** The `--type` values the arm matches. The empty string means "no `--type`". */
  types: string[];
  /** The values the flag offers for those types. */
  values: string[];
}

export function typeValueArms(values: TypeDependentValues): TypeValueArm[] {
  const arms: TypeValueArm[] = Object.entries(values.byType).map(([type, list]) => ({
    types: [type],
    values: [...list],
  }));
  if (values.fallback.length === 0) return arms;

  const same = arms.find((arm) => arm.values.join(" ") === values.fallback.join(" "));
  if (same) {
    same.types.push("");
  } else {
    arms.push({ types: [""], values: [...values.fallback] });
  }
  return arms;
}

/** The name of the variable that holds the `--type` of the command line. */
export const TYPE_VARIABLE = "flisk_type";

/** The condition of one `--type` arm, in the syntax of bash and zsh. */
export function shellTypeCondition(types: string[]): string {
  const parts = types
    .filter((type) => type !== "")
    .map((type) => `"$${TYPE_VARIABLE}" = "${type}"`);
  if (types.includes("")) parts.push(`-z "\${${TYPE_VARIABLE}}"`);
  return parts.join(" || ");
}

/** The stacks of the current project, read from the machine-readable CLI output. */
export const JSON_STACKS = `flisk stacks --json 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//'`;
/** The resources of the current project, read from the machine-readable CLI output. */
export const JSON_RESOURCES = `flisk resources --json 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//'`;

/** The flags whose values come from the current project: the stacks and the resources. */
export const PROJECT_VALUE_FLAGS: ReadonlySet<string> = new Set(["--stack", "--only"]);

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
  valueRows: { flag: string; values: string[] }[];
  /** The values of the flags that depend on the `--type` of the command line. */
  typeValueRows: TypeValueRow[];
}

function hasPositional(entry: CommandEntry, kinds: CompletionPositional[]): boolean {
  return entry.positional !== undefined && kinds.includes(entry.positional);
}

/**
 * Builds the rows the four renderers share from the candidates table.
 *
 * The renderers keep their own syntax; everything they each recomputed (the flattening, the
 * groupings by flags, positionals and values, the `--type` arms) is computed once here.
 */
export function buildCompletionTable(candidates: CompletionCandidates): CompletionTable {
  const entries = toEntries(candidates.commands);
  const flat = flatten(entries);
  return {
    entries,
    flat,
    words: commandWords(entries),
    aliasRows: entries.flatMap((entry) => entry.aliases.map((alias) => ({ alias, entry }))),
    subcommandRows: entries.flatMap((parent) =>
      parent.subcommands.map((subcommand) => ({ parent, subcommand })),
    ),
    withSubcommands: entries.filter((entry) => entry.subcommands.length > 0),
    topOptionEntries: entries.filter((entry) => entry.options.length > 0),
    optionEntries: flat.filter((entry) => entry.options.length > 0),
    subOptionEntries: flat.filter((entry) => entry.parent !== "" && entry.options.length > 0),
    subEntries: flat.filter((entry) => entry.parent !== ""),
    topPositionalEntries: entries.filter((entry) => entry.positional !== undefined),
    positionalEntries: flat.filter((entry) => entry.positional !== undefined),
    subPositionalEntries: flat.filter(
      (entry) => entry.parent !== "" && entry.positional !== undefined,
    ),
    stackEntries: flat.filter((entry) => hasPositional(entry, ["stacks", "stacks-and-resources"])),
    resourceEntries: flat.filter((entry) =>
      hasPositional(entry, ["resources", "stacks-and-resources"]),
    ),
    commandNameEntries: flat.filter((entry) => hasPositional(entry, ["commands"])),
    positionalValueEntries: flat.filter((entry) => (entry.positionalValues?.length ?? 0) > 0),
    commandValueRows: flat.flatMap((entry) =>
      Object.entries(entry.optionValues ?? {}).map(([flag, values]) => ({
        key: `${entry.path} ${flag}`,
        flag,
        values,
      })),
    ),
    valueRows: Object.entries(candidates.values).map(([flag, values]) => ({ flag, values })),
    typeValueRows: Object.entries(candidates.typeValues).map(([flag, values]) => ({
      flag,
      values,
      arms: typeValueArms(values),
    })),
  };
}
