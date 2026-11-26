// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The argument tables behind the MCP tools' CLI calls.
 *
 * A tool that runs `flisk <command>` declares its arguments once, in a table bound to that
 * command's CommandSpec from `command-specs.generated.ts` (the same generated table
 * `--help`, shell completion and the docs read). Each row is a flag bound to a spec option
 * (`option`), a positional bound to a spec argument (`positional`), a literal token such as
 * `"--json"` or `"--"`, an argument only the MCP layer knows (`mcpArg`), or a rule over
 * several arguments (`guard`). The one table drives both outputs a tool needs:
 *
 *   - `build`: the validated `flisk <args>` the handler's child process gets, emitted in
 *     row order;
 *   - `inputSchema`: the JSON schema `tools/list` advertises, generated from the same rows.
 *
 * Flag names, negation, variadic shape, descriptions, defaults and choices all come from
 * the spec, so an option exists in exactly one place and the MCP schema stays in lockstep
 * with the CLI: a new command option needs one row here, never a new hand-written builder.
 */
import { COMMAND_SPECS } from "../commands/command-specs.generated.js";
import type {
  CommandArgumentSpec,
  CommandOptionSpec,
  CommandSpec,
} from "../commands/command-specs.js";
import { FliskError } from "../utils/errors.js";
import { isValidCursor } from "../utils/log-cursors.js";
import {
  flag,
  names,
  optionalChoice,
  optionalName,
  optionalPath,
  optionalPort,
  optionalProjectName,
} from "./tools/shared.js";

export {
  flag,
  names,
  optionalChoice,
  optionalName,
  optionalPath,
  optionalPort,
  optionalProjectName,
};

const SINCE = /^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;

/** The spec of the command at `path` (for example ["config", "verify"]), or a failure if none exists. */
export function specOf(path: readonly string[]): CommandSpec {
  let level: readonly CommandSpec[] = COMMAND_SPECS;
  let spec: CommandSpec | undefined;
  for (const name of path) {
    spec = level.find((candidate) => candidate.name === name);
    if (!spec)
      throw new FliskError(`argSpec: no command spec for "${path.join(" ")}"`, [
        "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
      ]);
    level = spec.subcommands;
  }
  if (!spec?.hasAction) {
    throw new FliskError(
      `argSpec: "${path.join(" ")}" is a command group, not a runnable command`,
      [
        "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
      ],
    );
  }
  return spec;
}

/** The shared `projectPath` schema property every project-bound tool advertises. */
export const PROJECT_PATH: Record<string, unknown> = {
  type: "string",
  description: "Absolute path to the Flisk project root; run this operation from that directory.",
};

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

/** The long flag of a Commander flags string, or undefined for a short-only option such as "-q". */
function longFlagOf(flags: string): string | undefined {
  return /--[a-zA-Z][\w-]*/.exec(flags)?.[0];
}

/** Parse a Commander flags string such as "-s, --service <names...>" or "--no-ping". */
export function parseOptionFlags(flags: string): SpecOptionFlags {
  const long = longFlagOf(flags);
  if (!long)
    throw new FliskError(`argSpec: option spec has no long flag: "${flags}"`, [
      "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
    ]);
  const name = long.slice(2);
  const negated = name.startsWith("no-");
  const bare = negated ? name.slice(3) : name;
  const attribute = bare.replace(/-([a-z])/g, (_dash, letter: string) => letter.toUpperCase());
  const placeholder = /[[<]([\w-]+)(\.\.\.)?[>\]]/.exec(flags);
  return {
    long,
    attribute,
    negated,
    takesValue: placeholder !== null,
    variadic: placeholder?.[2] === "...",
  };
}

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
export type ValueKind =
  | "boolean"
  | "name"
  | "names"
  | "strings"
  | "path"
  | "port"
  | "int"
  | "number"
  | "duration"
  | "cursor"
  | "choice"
  | "raw";

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
export function option(flag: string, fields: ArgFields = {}): OptionRow {
  return { kind: "option", flag, ...fields };
}

/** Bind an MCP argument to a spec argument (a positional value) by its name. */
export function positional(argument: string, fields: ArgFields = {}): ArgumentRow {
  return { kind: "argument", argument, ...fields };
}

/** An argument that exists only on the MCP side and is never emitted to the CLI. */
export function mcpArg(arg: string, schema: Record<string, unknown>): McpRow {
  return { kind: "mcp", arg, schema };
}

/** A check over the whole argument object, run where the row sits in the table. */
export function guard(check: (args: Record<string, unknown>) => void): GuardRow {
  return { kind: "guard", check };
}

/** A bound row with its spec element resolved: the argument name, the value kind, the flag or argument. */
export interface ResolvedBinding {
  readonly row: OptionRow | ArgumentRow;
  readonly arg: string;
  readonly as: ValueKind;
  readonly option?: { spec: CommandOptionSpec; flags: SpecOptionFlags };
  readonly argument?: CommandArgumentSpec;
}

function inferKind(command: string, row: OptionRow, parsed: SpecOptionFlags): ValueKind {
  if (!parsed.takesValue) return "boolean";
  if (parsed.variadic) return "names";
  throw new FliskError(`argSpec: ${command} ${row.flag} takes a value and needs an explicit "as"`, [
    "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
  ]);
}

/** Match one row against its spec element, or fail with the command it should have been on. */
export function resolveRow(spec: CommandSpec, row: OptionRow | ArgumentRow): ResolvedBinding {
  const command = spec.path.join(" ");
  if (row.kind === "option") {
    // A short-only option (such as "-q") has no long flag to match: skip it instead of letting
    // parseOptionFlags throw before the row's own option is reached.
    const specOption = spec.options.find((o) => longFlagOf(o.flags) === row.flag);
    if (!specOption)
      throw new FliskError(`argSpec: ${command} has no option ${row.flag}`, [
        "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
      ]);
    const parsed = parseOptionFlags(specOption.flags);
    const arg = row.arg ?? parsed.attribute;
    const as = row.as ?? inferKind(command, row, parsed);
    if (as === "boolean" && parsed.takesValue) {
      throw new FliskError(
        `argSpec: ${command} ${row.flag} takes a value and cannot be "boolean"`,
        [
          "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
        ],
      );
    }
    if ((as === "names" || as === "strings") && !parsed.variadic) {
      throw new FliskError(
        `argSpec: ${command} ${row.flag} is not variadic and cannot take "${as}"`,
        [
          "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
        ],
      );
    }
    return { row, arg, as, option: { spec: specOption, flags: parsed } };
  }
  const specArgument = spec.arguments.find((a) => a.name === row.argument);
  if (!specArgument)
    throw new FliskError(`argSpec: ${command} has no argument ${row.argument}`, [
      "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
    ]);
  const arg = row.arg ?? specArgument.name;
  const as = row.as ?? (specArgument.variadic ? "strings" : "name");
  if (as === "boolean") {
    throw new FliskError(
      `argSpec: ${command} ${row.argument} is a positional and cannot be "boolean"`,
      [
        "This is a bug in the MCP tool table, not in your input. Report it at https://github.com/flisk-sh/flisk/issues",
      ],
    );
  }
  return { row, arg, as, argument: specArgument };
}

function checkMinItems(binding: ResolvedBinding, list: unknown[]): void {
  const { row, arg } = binding;
  if (row.minItems !== undefined && list.length < row.minItems) {
    throw new FliskError(row.requiredMessage ?? `${arg} must name at least ${row.minItems}`, [
      ...(row.suggestions ?? []),
    ]);
  }
}

/** Whether the boolean row's flag is emitted for this value of its argument. */
function booleanEmits(binding: ResolvedBinding, raw: unknown): boolean {
  const { row, arg } = binding;
  const parsed = binding.option?.flags;
  const negatedSelf = parsed?.negated === true && arg === parsed.attribute;
  const resolved = flag(raw, arg, (row.default ?? negatedSelf) === true);
  return resolved === (row.when ?? !negatedSelf);
}

/** Refuse an omitted required argument, with the row's own message and suggestions. */
function failRequired(binding: ResolvedBinding): never {
  const { row, arg } = binding;
  throw new FliskError(row.requiredMessage ?? `${arg} is required`, [...(row.suggestions ?? [])]);
}

/** Validate one bound value (undefined for absent optional arguments) and coerce it for emission. */
function readValue(binding: ResolvedBinding, raw: unknown): unknown {
  const { row, as } = binding;
  const arg = binding.arg;
  let value = raw;
  if (as === "number" && typeof value !== "number") value = undefined;
  if (value === undefined) value = row.default;
  if (value === undefined) {
    if (row.required) failRequired(binding);
    return undefined;
  }
  switch (as) {
    case "raw":
    case "number":
      break;
    case "name":
      value = optionalName(value, arg);
      break;
    case "names": {
      const list = names(value, arg);
      checkMinItems(binding, list);
      value = list;
      break;
    }
    case "strings": {
      const list = Array.isArray(value)
        ? value.filter((part): part is string => typeof part === "string")
        : [];
      checkMinItems(binding, list);
      value = list;
      break;
    }
    case "path":
      value = optionalPath(value, arg);
      break;
    case "port":
      value = optionalPort(value, arg);
      break;
    case "int":
      if (
        !Number.isInteger(value) ||
        (row.min !== undefined && (value as number) < row.min) ||
        (row.max !== undefined && (value as number) > row.max)
      ) {
        throw new FliskError(row.invalid ?? `${arg} must be an integer`, [
          ...(row.suggestions ?? []),
        ]);
      }
      break;
    case "duration":
      if (typeof value !== "string" || !SINCE.test(value)) {
        throw new FliskError(row.invalid ?? `${arg} must be a duration such as 30s, 5m or 1h`, [
          ...(row.suggestions ?? []),
        ]);
      }
      break;
    case "cursor": {
      const cursor = typeof value === "number" ? String(value) : value;
      if (typeof cursor !== "string" || !isValidCursor(cursor)) {
        throw new FliskError(row.invalid ?? `${arg} must be a non-negative integer cursor`, [
          ...(row.suggestions ?? []),
        ]);
      }
      value = cursor;
      break;
    }
    case "choice": {
      const choices =
        row.choices ?? binding.option?.spec.argChoices ?? binding.argument?.argChoices ?? [];
      if (row.invalid !== undefined) {
        if (typeof value !== "string" || !choices.includes(value)) {
          throw new FliskError(row.invalid, [...(row.suggestions ?? [])]);
        }
      } else {
        value = optionalChoice(value, arg, choices);
      }
      break;
    }
    case "boolean":
      // Handled by booleanEmits; a "boolean" never reaches readValue.
      break;
  }
  return row.coerce ? row.coerce(value, arg) : value;
}

/** The argv a table emits for `args`: the command path plus each row's emission, in row order. */
export function buildArgs(
  spec: CommandSpec,
  rows: readonly ArgRow[],
  args: Record<string, unknown>,
): string[] {
  const out = [...spec.path];
  for (const row of rows) {
    if (typeof row === "string") {
      out.push(row);
      continue;
    }
    if (row.kind === "guard") {
      row.check(args);
      continue;
    }
    if (row.kind === "mcp") continue;
    const binding = resolveRow(spec, row);
    if (binding.as === "boolean") {
      // An omitted required boolean fails like any other required row; an explicit false is
      // a value and simply omits the flag.
      if (row.required && args[binding.arg] === undefined && row.default === undefined) {
        failRequired(binding);
      }
      // resolveRow already refused a "boolean" on anything but an option binding.
      const long = binding.option?.flags.long;
      if (long && booleanEmits(binding, args[binding.arg])) out.push(long);
      continue;
    }
    const value = readValue(binding, args[binding.arg]);
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      out.push(row.kind === "option" ? `${row.flag}=${String(item)}` : String(item));
    }
  }
  return out;
}

/** The JSON schema property one binding advertises: type and shape from the spec, copy from the row. */
function propertySchema(binding: ResolvedBinding): Record<string, unknown> {
  const { row, as } = binding;
  const property: Record<string, unknown> =
    as === "names" || as === "strings"
      ? { type: "array", items: { type: "string" } }
      : {
          type:
            as === "boolean"
              ? "boolean"
              : as === "port" || as === "int"
                ? "integer"
                : as === "number"
                  ? "number"
                  : "string",
        };
  const description =
    row.description === null
      ? undefined
      : (row.description ?? binding.option?.spec.description ?? binding.argument?.description);
  if (description) property.description = description;
  const choices = row.choices ?? binding.option?.spec.argChoices ?? binding.argument?.argChoices;
  if (choices?.length) property.enum = [...choices];
  if (as === "port" || row.min !== undefined) property.minimum = row.min ?? 1;
  if (as === "port" || row.max !== undefined) property.maximum = row.max ?? 65535;
  if (typeof row.schema === "object") Object.assign(property, row.schema);
  return property;
}

/**
 * The tool's inputSchema, generated from the same rows `build` reads. `projectPath: true`
 * adds the shared project-root property first; pass an object to give a tool its own text.
 */
export function inputSchema(
  spec: CommandSpec,
  rows: readonly ArgRow[],
  options: { projectPath?: boolean | Record<string, unknown> } = {},
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (options.projectPath) {
    properties.projectPath = options.projectPath === true ? PROJECT_PATH : options.projectPath;
  }
  const required: string[] = [];
  for (const row of rows) {
    if (typeof row === "string" || row.kind === "guard") continue;
    if (row.kind === "mcp") {
      properties[row.arg] = row.schema;
      continue;
    }
    if (row.schema === false) continue;
    const binding = resolveRow(spec, row);
    properties[binding.arg] = propertySchema(binding);
    if (row.required && row.schemaRequired !== false) required.push(binding.arg);
  }
  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  };
}

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
export function argSpec(path: readonly string[], rows: readonly ArgRow[]): ArgSpec {
  const spec = specOf(path);
  const bindings = rows
    .filter(
      (row): row is OptionRow | ArgumentRow =>
        typeof row !== "string" && (row.kind === "option" || row.kind === "argument"),
    )
    .map((row) => resolveRow(spec, row));
  return {
    spec,
    rows,
    bindings,
    build: (args) => buildArgs(spec, rows, args),
    inputSchema: (options = {}) => inputSchema(spec, rows, options),
  };
}
