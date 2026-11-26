// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/** The Zsh completion script. */
import type { CompletionCandidates, CompletionOption } from "./completion-candidates.js";
import {
  buildCompletionTable,
  type CommandEntry,
  JSON_RESOURCES,
  JSON_STACKS,
  shellTypeCondition,
  shortDescription,
  TYPE_VARIABLE,
  type TypeValueArm,
  valuesOf,
} from "./completion-core.js";

/** The `--type` of the current command line, in zsh. */
const ZSH_TYPE = `    local ${TYPE_VARIABLE}=""
    local i
    for (( i = 2; i < CURRENT; i++ )); do
        if [[ "\${words[i]}" = "--type" ]]; then
            ${TYPE_VARIABLE}="\${words[i+1]}"
        elif [[ "\${words[i]}" = "--type="* ]]; then
            ${TYPE_VARIABLE}="\${words[i]#--type=}"
        fi
    done`;

/** The values of a flag that depend on the `--type`, in zsh. */
function zshTypeValues(flag: string, arms: TypeValueArm[]): string {
  const lines = [
    `    local -a ${TYPE_VARIABLE}_values`,
    `    if [[ ${shellTypeCondition(arms[0].types)} ]]; then`,
    `        ${TYPE_VARIABLE}_values=(${arms[0].values.join(" ")})`,
  ];
  for (const arm of arms.slice(1)) {
    lines.push(`    elif [[ ${shellTypeCondition(arm.types)} ]]; then`);
    lines.push(`        ${TYPE_VARIABLE}_values=(${arm.values.join(" ")})`);
  }
  lines.push("    fi");
  lines.push(
    `    (( $#${TYPE_VARIABLE}_values )) && _describe -t values '${flag.slice(2)}' ${TYPE_VARIABLE}_values`,
  );
  return lines.join("\n");
}

/** The `_arguments` spec of the positional argument of a command. */
function zshPositionalSpecs(entry: CommandEntry): string[] {
  // A command with sub-commands completes the name of the sub-command, not a value.
  if (entry.subcommands.length > 0) {
    return [`'1: :_flisk_${entry.name}_subcommands'`];
  }
  switch (entry.positional) {
    case "stacks":
      return ["'1:stack:_flisk_stacks'"];
    case "resources":
      return ["'1:resource:_flisk_resources'"];
    case "stacks-and-resources":
      return ["'1:target:_flisk_stacks'"];
    case "commands":
      return ["'1:command:_flisk_commands'"];
    case "hosts":
      return [`'1:${entry.argument ?? "host"}:(${(entry.positionalValues ?? []).join(" ")})'`];
    default:
      break;
  }
  // A command with a positional argument still needs the spec, otherwise the value of a flag that
  // follows the argument is not completed.
  if (entry.argument) {
    return [entry.variadic ? `'*:${entry.argument}:'` : `'1:${entry.argument}:'`];
  }
  return [];
}

/** The `_arguments` spec of one flag, with the values it completes when it has them. */
function zshOptionSpec(
  option: CompletionOption,
  candidates: CompletionCandidates,
  entry: CommandEntry,
): string {
  const description = shortDescription(option.description);
  if (candidates.typeValues[option.flag]) {
    return `'${option.flag}[${description}]:${option.flag.slice(2)}:_flisk_${option.flag.slice(2)}_values'`;
  }
  const values = valuesOf(option.flag, candidates, entry);
  if (values) {
    return `'${option.flag}[${description}]:${option.flag.slice(2)}:(${values.join(" ")})'`;
  }
  if (option.flag === "--stack") {
    return `'${option.flag}[${description}]:stack:_flisk_stacks'`;
  }
  if (option.flag === "--only") {
    return `'${option.flag}[${description}]:service:_flisk_resources'`;
  }
  return option.takesValue
    ? `'${option.flag}[${description}]:${option.flag.slice(2)}:'`
    : `'${option.flag}[${description}]'`;
}

export function renderZsh(candidates: CompletionCandidates): string {
  const table = buildCompletionTable(candidates);
  const globalFlags = candidates.globalOptions
    .map((option) => `'${option.flag}[${shortDescription(option.description)}]'`)
    .join(" \\\n        ");

  const commandBranches = table.entries
    .map((entry) => {
      const specs = [
        ...entry.options.map((option) => zshOptionSpec(option, candidates, entry)),
        ...zshPositionalSpecs(entry),
      ];
      if (entry.subcommands.length > 0) {
        specs.push(`'*:: :->${entry.name}_args'`);
      }
      if (specs.length === 0) return "";

      // The aliases are the same command under a different name.
      const words = [entry.name, ...entry.aliases].join("|");
      return `        ${words})\n            _arguments \\\n                ${specs.join(" \\\n                ")}\n            ;;`;
    })
    .filter((branch) => branch !== "")
    .join("\n");

  const subCommandStates = table.withSubcommands
    .map((entry) => {
      const branches = entry.subcommands
        .map((subcommand) => {
          const specs = [
            ...subcommand.options.map((option) => zshOptionSpec(option, candidates, subcommand)),
            ...zshPositionalSpecs(subcommand),
          ];
          if (specs.length === 0) return "";
          return `                ${subcommand.name})\n                    _arguments \\\n                        ${specs.join(" \\\n                        ")}\n                    ;;`;
        })
        .filter((branch) => branch !== "")
        .join("\n");
      return `        ${entry.name}_args)\n            case "$line[1]" in\n${branches}\n            esac\n            ;;`;
    })
    .join("\n");

  const commandList = table.entries
    .flatMap((entry) => [
      `        '${entry.name}:${shortDescription(entry.description)}'`,
      ...entry.aliases.map((alias) => `        '${alias}:${shortDescription(entry.description)}'`),
    ])
    .join("\n");

  const subCommandLists = table.withSubcommands
    .map(
      (entry) =>
        `_flisk_${entry.name}_subcommands() {\n    local commands=(\n${entry.subcommands
          .map(
            (subcommand) =>
              `        '${subcommand.name}:${shortDescription(subcommand.description)}'`,
          )
          .join("\n")}\n    )\n    _describe -t commands '${entry.name} command' commands\n}`,
    )
    .join("\n\n");

  const typeValueFunctions = table.typeValueRows
    .map(
      ({ flag, arms }) =>
        `_flisk_${flag.slice(2)}_values() {\n${ZSH_TYPE}\n${zshTypeValues(flag, arms)}\n}`,
    )
    .join("\n\n");

  return `#compdef flisk

# Flisk CLI Zsh Completion
# Generated by "flisk completion zsh". The command and flag lists come from the CLI itself.

_flisk() {
    local curcontext="$curcontext" state line
    typeset -A opt_args

    _arguments -C \\
        ${globalFlags} \\
        '1: :_flisk_commands' \\
        '*:: :->args'

    case "$line[1]" in
${commandBranches}
    esac

    case "$state" in
${subCommandStates}
    esac
}

_flisk_commands() {
    local commands=(
${commandList}
    )
    _describe -t commands 'flisk command' commands
}

_flisk_stacks() {
    local stacks
    stacks=($(${JSON_STACKS}))
    _describe -t stacks 'stack' stacks
}

_flisk_resources() {
    local resources
    resources=($(${JSON_RESOURCES}))
    _describe -t resources 'resource' resources
}

${subCommandLists}

${typeValueFunctions}

# Autoloaded from fpath, this file is the body of _flisk, so run it now to complete the first TAB.
# Sourced (\`source <(flisk completion zsh)\`), register it instead.
if [ "$funcstack[1]" = "_flisk" ]; then
    _flisk "$@"
else
    compdef _flisk flisk
fi
`;
}
