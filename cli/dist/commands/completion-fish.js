import { buildCompletionTable, PROJECT_VALUE_FLAGS, shortDescription, TYPE_VARIABLE, valuesOf, } from "./completion-core.js";
/** The stacks of the current project, read from the machine-readable CLI output, in fish. */
const FISH_STACKS = `flisk stacks --json 2>/dev/null | string match -a -r "\\"name\\":\\"[^\\"]*\\"" | string replace -r "\\"name\\":\\"([^\\"]*)\\"" "\\$1"`;
/** The resources of the current project, read from the machine-readable CLI output, in fish. */
const FISH_RESOURCES = `flisk resources --json 2>/dev/null | string match -a -r "\\"name\\":\\"[^\\"]*\\"" | string replace -r "\\"name\\":\\"([^\\"]*)\\"" "\\$1"`;
/** The `--type` of the current command line, in fish. */
const FISH_TYPE = `function __flisk_resource_type
    set -l tokens (commandline -opc)
    set -l ${TYPE_VARIABLE} ""
    set -l token_count (count $tokens)
    for i in (seq $token_count)
        if test "$tokens[$i]" = "--type"
            if test $i -lt $token_count
                set next_index (math $i + 1)
                set ${TYPE_VARIABLE} "$tokens[$next_index]"
            end
        else if string match -q -- "--type=*" "$tokens[$i]"
            set ${TYPE_VARIABLE} (string replace -- "--type=" "" "$tokens[$i]")
        end
    end
    echo $${TYPE_VARIABLE}
end`;
/** The values of a flag that depend on the `--type`, in fish. */
function fishTypeValues(arms) {
    const lines = ["    switch (__flisk_resource_type)"];
    for (const arm of arms) {
        lines.push(`        case ${arm.types.map((type) => (type === "" ? "''" : type)).join(" ")}`);
        lines.push(`            printf '%s\\n' ${arm.values.join(" ")}`);
    }
    lines.push("    end");
    return lines.join("\n");
}
/** The fish condition that holds while the user is in a command. */
function fishCondition(entry) {
    return entry.parent === ""
        ? `__fish_seen_subcommand_from ${entry.name}`
        : `__fish_seen_subcommand_from ${entry.parent}; and __fish_seen_subcommand_from ${entry.name}`;
}
/** The fish argument that lists the values of a flag. */
function fishValueArgument(option, candidates, entry) {
    if (candidates.typeValues[option.flag]) {
        return ` -r -a '(__flisk_${option.flag.slice(2)}_values)'`;
    }
    const values = valuesOf(option.flag, candidates, entry);
    return values ? ` -r -a '${values.join(" ")}'` : "";
}
export function renderFish(candidates) {
    const table = buildCompletionTable(candidates);
    const commandLines = table.entries.map((entry) => `complete -c flisk -f -n '__fish_use_subcommand' -a '${entry.name}' -d '${shortDescription(entry.description)}'`);
    const aliasLines = table.aliasRows.map(({ alias, entry }) => `complete -c flisk -f -n '__fish_use_subcommand' -a '${alias}' -d '${shortDescription(entry.description)}'`);
    const subCommandLines = table.subcommandRows.map(({ parent, subcommand }) => `complete -c flisk -f -n '__fish_seen_subcommand_from ${parent.name}' -a '${subcommand.name}' -d '${shortDescription(subcommand.description)}'`);
    const optionLines = table.optionEntries.flatMap((entry) => entry.options
        .filter((option) => !PROJECT_VALUE_FLAGS.has(option.flag))
        .map((option) => {
        // `-r` tells fish that the flag takes a value, so it offers the values after it.
        const args = fishValueArgument(option, candidates, entry);
        return `complete -c flisk -f -n '${fishCondition(entry)}' -l ${option.flag.slice(2)} -d '${shortDescription(option.description)}'${args}`;
    }));
    // The flags whose values come from the current project.
    const projectFlagLines = table.optionEntries.flatMap((entry) => entry.options
        .filter((option) => PROJECT_VALUE_FLAGS.has(option.flag))
        .map((option) => {
        const values = option.flag === "--stack" ? `(${FISH_STACKS})` : `(${FISH_RESOURCES})`;
        return `complete -c flisk -f -n '${fishCondition(entry)}' -l ${option.flag.slice(2)} -r -d '${shortDescription(option.description)}' -a '${values}'`;
    }));
    const globalLines = candidates.globalOptions.map((option) => `complete -c flisk -f -l ${option.flag.slice(2)} -d '${shortDescription(option.description)}'`);
    const stackLines = table.stackEntries.map((entry) => `complete -c flisk -f -n '${fishCondition(entry)}' -a '(${FISH_STACKS})'`);
    const resourceLines = table.resourceEntries.map((entry) => `complete -c flisk -f -n '${fishCondition(entry)}' -a '(${FISH_RESOURCES})'`);
    // The names of the other commands, for `flisk help <command>`.
    const commandNameLines = table.commandNameEntries.map((entry) => `complete -c flisk -f -n '${fishCondition(entry)}' -a '${table.words.join(" ")}'`);
    // Fixed values of a positional argument, such as the hosts of `flisk connect <host>`.
    const positionalValueLines = table.positionalValueEntries.map((entry) => `complete -c flisk -f -n '${fishCondition(entry)}' -a '${entry.positionalValues?.join(" ")}'`);
    const typeValueFunctions = table.typeValueRows
        .map(({ flag, arms }) => `function __flisk_${flag.slice(2)}_values\n${fishTypeValues(arms)}\nend`)
        .join("\n\n");
    return `# Flisk CLI Fish Completion
# Generated by "flisk completion fish". The command and flag lists come from the CLI itself.

# Disable file completions for most commands
complete -c flisk -f

# Commands
${commandLines.join("\n")}

# Command aliases
${aliasLines.join("\n")}

# Sub-commands
${subCommandLines.join("\n")}

# Global options
${globalLines.join("\n")}

# Command options
${optionLines.join("\n")}

# Flags whose values come from the current project
${projectFlagLines.join("\n")}

# Project values
${[...stackLines, ...resourceLines, ...commandNameLines].join("\n")}

# Fixed positional values
${positionalValueLines.join("\n")}

# The type of the current command line, for the flags whose values depend on it
${FISH_TYPE}

# The values of the flags that depend on the type
${typeValueFunctions}
`;
}
