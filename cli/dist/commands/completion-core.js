export function toEntries(commands, parent = "") {
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
export function flatten(entries) {
    return entries.flatMap((entry) => [entry, ...flatten(entry.subcommands)]);
}
/** The words that start a command: the name and every alias. */
export function commandWords(entries) {
    return entries.flatMap((entry) => [entry.name, ...entry.aliases]);
}
/** A short description, without the characters the shell literals cannot hold. */
export function shortDescription(description) {
    const text = description.replace(/[[\]'":]/g, "").trim();
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
export function flagList(options) {
    return options.map((option) => option.flag).join(" ");
}
/** The values of a flag, for the command that is being completed. */
export function valuesOf(flag, candidates, entry) {
    return entry?.optionValues?.[flag] ?? candidates.values[flag];
}
export function typeValueArms(values) {
    const arms = Object.entries(values.byType).map(([type, list]) => ({
        types: [type],
        values: [...list],
    }));
    if (values.fallback.length === 0)
        return arms;
    const same = arms.find((arm) => arm.values.join(" ") === values.fallback.join(" "));
    if (same) {
        same.types.push("");
    }
    else {
        arms.push({ types: [""], values: [...values.fallback] });
    }
    return arms;
}
/** The name of the variable that holds the `--type` of the command line. */
export const TYPE_VARIABLE = "flisk_type";
/** The condition of one `--type` arm, in the syntax of bash and zsh. */
export function shellTypeCondition(types) {
    const parts = types
        .filter((type) => type !== "")
        .map((type) => `"$${TYPE_VARIABLE}" = "${type}"`);
    if (types.includes(""))
        parts.push(`-z "\${${TYPE_VARIABLE}}"`);
    return parts.join(" || ");
}
/** The stacks of the current project, read from the machine-readable CLI output. */
export const JSON_STACKS = `flisk stacks --json 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//'`;
/** The resources of the current project, read from the machine-readable CLI output. */
export const JSON_RESOURCES = `flisk resources --json 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//'`;
/** The flags whose values come from the current project: the stacks and the resources. */
export const PROJECT_VALUE_FLAGS = new Set(["--stack", "--only"]);
function hasPositional(entry, kinds) {
    return entry.positional !== undefined && kinds.includes(entry.positional);
}
/**
 * Builds the rows the four renderers share from the candidates table.
 *
 * The renderers keep their own syntax; everything they each recomputed (the flattening, the
 * groupings by flags, positionals and values, the `--type` arms) is computed once here.
 */
export function buildCompletionTable(candidates) {
    const entries = toEntries(candidates.commands);
    const flat = flatten(entries);
    return {
        entries,
        flat,
        words: commandWords(entries),
        aliasRows: entries.flatMap((entry) => entry.aliases.map((alias) => ({ alias, entry }))),
        subcommandRows: entries.flatMap((parent) => parent.subcommands.map((subcommand) => ({ parent, subcommand }))),
        withSubcommands: entries.filter((entry) => entry.subcommands.length > 0),
        topOptionEntries: entries.filter((entry) => entry.options.length > 0),
        optionEntries: flat.filter((entry) => entry.options.length > 0),
        subOptionEntries: flat.filter((entry) => entry.parent !== "" && entry.options.length > 0),
        subEntries: flat.filter((entry) => entry.parent !== ""),
        topPositionalEntries: entries.filter((entry) => entry.positional !== undefined),
        positionalEntries: flat.filter((entry) => entry.positional !== undefined),
        subPositionalEntries: flat.filter((entry) => entry.parent !== "" && entry.positional !== undefined),
        stackEntries: flat.filter((entry) => hasPositional(entry, ["stacks", "stacks-and-resources"])),
        resourceEntries: flat.filter((entry) => hasPositional(entry, ["resources", "stacks-and-resources"])),
        commandNameEntries: flat.filter((entry) => hasPositional(entry, ["commands"])),
        positionalValueEntries: flat.filter((entry) => (entry.positionalValues?.length ?? 0) > 0),
        commandValueRows: flat.flatMap((entry) => Object.entries(entry.optionValues ?? {}).map(([flag, values]) => ({
            key: `${entry.path} ${flag}`,
            flag,
            values,
        }))),
        valueRows: Object.entries(candidates.values).map(([flag, values]) => ({ flag, values })),
        typeValueRows: Object.entries(candidates.typeValues).map(([flag, values]) => ({
            flag,
            values,
            arms: typeValueArms(values),
        })),
    };
}
