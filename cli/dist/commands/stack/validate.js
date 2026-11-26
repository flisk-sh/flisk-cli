// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { errorFactories, FliskError } from "../../utils/errors.js";
import { JsonCommandError } from "../../utils/json-command.js";
export function normalizeResourceNames(names) {
    const normalizedNames = names.flatMap((name) => name
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean));
    return [...new Set(normalizedNames)];
}
/**
 * `flisk stack list` reads as the listing verb, but the positional is a
 * stack name, so the bare word is treated as a stack called "list" and
 * opens the assignment wizard. Treat it as --list instead; the MCP tool is
 * already called `stack_list`.
 */
export function isBareStackListRequest(stackName) {
    return stackName?.toLowerCase() === "list";
}
/**
 * Reject positional arguments beyond the stack name, with hints for the two
 * command shapes people most often mean (`stack assign` and `stack create`).
 */
export function assertNoExtraStackArguments(stackName, extra) {
    if (!extra.length)
        return;
    if (stackName === "assign" && extra.length === 2) {
        const [resource, stack] = extra;
        throw new FliskError("Assign one resource by naming the stack first.", [
            `flisk stack ${stack} --resources ${resource}`,
            "List resources without a stack: flisk stack --list",
        ]);
    }
    if (stackName === "create" && extra.length === 1) {
        throw new FliskError("A stack is created when you assign resources to it.", [
            `flisk stack ${extra[0]} --resources <name>`,
            "List resources without a stack: flisk stack --list",
        ]);
    }
    throw new FliskError("Provide one stack name and pass resource names with --resources.", [
        "flisk stack <stack> --resources <name>",
    ]);
}
/**
 * Reject flag combinations the command cannot honor, in the order the run
 * would hit them. A bare `list` positional may name a stack only when it
 * arrives without --resources; with --resources it is refused outright so a
 * stack that `flisk stack --list` could never address is never stored.
 */
export function assertCompatibleStackOptions(stackName, options) {
    if (options.move && options.remove) {
        throw new FliskError("--move and --remove cannot be used together.", [
            "Use --move to assign resources to another stack, or --remove to leave them unassigned.",
        ]);
    }
    if (options.list && (options.move || options.remove)) {
        throw new FliskError("--list cannot be combined with --move or --remove.", [
            "Run flisk stack --list separately to inspect assignments without changing them.",
        ]);
    }
    if (options.remove && stackName) {
        throw new FliskError("--remove does not take a stack name.", [
            "Use: flisk stack --remove --resources <name...> --yes",
        ]);
    }
    if ((options.move || options.remove) && options.resources === undefined) {
        throw new FliskError("--move and --remove require --resources <name...>.", [
            "Pass --resources <name...> to name the resources you want to update.",
            "Run flisk resources to see the available resource names.",
        ]);
    }
    if (isBareStackListRequest(stackName) && options.resources !== undefined) {
        throw new FliskError('"list" is reserved for listing stacks and cannot be used as a stack name.', [
            "Use: flisk stack --list",
            "Pick another stack name, for example: flisk stack core --resources <name...>",
        ]);
    }
}
/**
 * --json never prompts: it takes the same arguments as a run without a
 * terminal. Without a TTY (or under --json) the invocation must carry every
 * answer the interactive flow would have asked for.
 */
export function assertNonInteractiveInputs(stackName, options, isTTY) {
    if (isTTY && !options.json)
        return;
    if (options.resources === undefined) {
        throw new FliskError("Interactive resource selection requires a TTY.", [
            "Pass --resources <name...> to select resources without a prompt.",
            "Use --list to inspect unassigned resources without changing them.",
        ]);
    }
    if (!stackName && !options.remove) {
        throw new FliskError("A stack name is required when stdin is not a TTY.", [
            "Use: flisk stack <stack-name> --resources <name...> [--yes]",
        ]);
    }
    if (!options.yes && !options.json) {
        throw new FliskError("Confirmation requires a TTY.", [
            "Pass --yes to skip confirmation when updating resources without a TTY.",
        ]);
    }
}
/**
 * Resolve --resources names to the service.json files they mean: normalize the
 * names, refuse duplicates, unknown names and already-assigned resources, and
 * plan the folder moves a --move between `services/<stack>/<name>` folders
 * takes. Pure planning: nothing is written here.
 */
export function planNamedResourceUpdates(names, discovered, projectRoot, targetStack, options = {}) {
    const requestedNames = normalizeResourceNames(names);
    if (requestedNames.length === 0 || requestedNames.some((name) => name.startsWith("-"))) {
        throw new JsonCommandError("USAGE", "--resources needs at least one resource name", ["Example: `flisk stack api --resources users-api orders-api --yes`"], 2);
    }
    const configPathsByName = new Map();
    for (const resource of discovered) {
        const configPaths = configPathsByName.get(resource.name) ?? [];
        configPaths.push(resource.configPath);
        configPathsByName.set(resource.name, configPaths);
    }
    const duplicates = [...configPathsByName].filter(([, configPaths]) => configPaths.length > 1);
    if (duplicates.length > 0) {
        throw new FliskError("Cannot update resources while duplicate names are present.", duplicates.map(([name, configPaths]) => `Duplicate "${name}" found in ${configPaths.join(" and ")}`));
    }
    const validNames = [...configPathsByName.keys()].sort((a, b) => a.localeCompare(b));
    const resourceByName = new Map(discovered.map((resource) => [resource.name, resource]));
    const exists = options.exists ?? existsSync;
    const selectedPaths = [];
    const relocations = new Map();
    // Two resources from different stacks can share a folder basename, so two
    // planned moves can land on one target folder. The exists check runs at
    // selection time, before anything is moved, so it passes for both and the
    // second rename then fails after the first move already happened. Claim
    // each target up front instead.
    const moveTargets = new Map();
    for (const name of requestedNames) {
        const resource = resourceByName.get(name);
        if (!resource) {
            const error = errorFactories.resourceNotFound(name, validNames);
            error.suggestions.unshift(`Valid resources: ${validNames.join(", ")}`);
            throw error;
        }
        if (resource.stack && !options.move && !options.remove) {
            throw new FliskError(`Resource "${name}" is already assigned to stack "${resource.stack}".`, [
                "Pass --move to move it, or --remove to clear its stack assignment.",
            ]);
        }
        if (options.move && targetStack && resource.stack && resource.stack !== targetStack) {
            const resourceDir = dirname(resource.configPath);
            if (resolve(dirname(resourceDir)) === resolve(projectRoot, "services", resource.stack)) {
                const targetDir = join(projectRoot, "services", targetStack, basename(resourceDir));
                const claimedBy = moveTargets.get(resolve(targetDir));
                if (claimedBy) {
                    throw new FliskError(`Cannot move "${name}" to stack "${targetStack}": "${claimedBy}" already moves to ${targetDir}.`, [
                        "Two resources from different stacks share this folder name; rename one of them first.",
                    ]);
                }
                if (exists(targetDir)) {
                    throw new FliskError(`Cannot move "${name}" to stack "${targetStack}": ${targetDir} already exists.`, ["Move or rename the existing folder, then run the command again."]);
                }
                moveTargets.set(resolve(targetDir), name);
                relocations.set(resource.configPath, join(targetDir, basename(resource.configPath)));
            }
        }
        selectedPaths.push(resource.configPath);
    }
    return { selectedPaths, relocations };
}
