// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { Command } from "commander";
import { addYesOption, assertValid } from "../utils/command-helpers.js";
import { byCodeUnit } from "../utils/compare.js";
import { createDiscoveryContext } from "../utils/discovery-context.js";
import { errorFactories, requireProjectRoot, runCommand } from "../utils/errors.js";
import { enforceFliskVersionGate } from "../utils/flisk-version-gate.js";
import { formatCount, showAllSatisfyCondition, showCommandHeader, showDetail, showSuccess, } from "../utils/formatting.js";
import { runJsonCommand } from "../utils/json-command.js";
import { findProjectRoot } from "../utils/paths.js";
import { validateStackName } from "../utils/validation.js";
import { writeStackAssignments } from "./stack/assign.js";
import { confirmStackUpdate, promptForResources, promptForStackName } from "./stack/prompt.js";
import { assertCompatibleStackOptions, assertNoExtraStackArguments, assertNonInteractiveInputs, isBareStackListRequest, planNamedResourceUpdates, } from "./stack/validate.js";
export { parseStackResourceConfig } from "./stack/assign.js";
export { normalizeResourceNames } from "./stack/validate.js";
export const stackCommand = addYesOption(new Command("stack"))
    .description("Organize resources into stacks (groups)")
    .argument("[stack-name]", "Stack name to assign to resources")
    .argument("[extra...]", "Additional positional inputs (resource names use --resources)")
    .option("--list", "List resources without a stack", false)
    .option("--resources <names...>", "Resource names to update (comma- or space-separated)")
    .option("--move", "Allow moving named resources from another stack", false)
    .option("--remove", "Remove the stack field from named resources", false)
    .option("--ignore-version", "Continue even if the CLI does not match the project's version requirements", false)
    .option("--json", "Print one JSON envelope on stdout; implies --yes and needs --list, <stack-name> --resources, or --remove --resources", false)
    .addHelpText("after", "\nExamples:\n  flisk stack --list\n  flisk stack shop --resources orders-api web\n  flisk stack shop --move --resources orders-api --yes\n  flisk stack --remove --resources orders-api --yes")
    .action(async (stackName, extra, options) => {
    const action = async () => {
        assertNoExtraStackArguments(stackName, extra);
        const projectRoot = options.json ? findProjectRoot() : requireProjectRoot();
        if (!projectRoot)
            throw errorFactories.notInProject();
        enforceFliskVersionGate(projectRoot, {
            ignoreVersion: options.ignoreVersion,
            json: options.json,
        });
        showCommandHeader("Stack Management");
        assertCompatibleStackOptions(stackName, options);
        const listRequested = options.list || isBareStackListRequest(stackName);
        const discovery = createDiscoveryContext();
        const report = (updated = [], stack = listRequested || options.remove ? null : (stackName ?? null), changedPaths = new Set(updated.map((resource) => resource.configPath))) => {
            const counts = new Map();
            const unassigned = [];
            for (const resource of discovery.resources) {
                const currentStack = changedPaths.has(resource.configPath) ? stack : resource.stack;
                if (currentStack) {
                    counts.set(currentStack, (counts.get(currentStack) ?? 0) + 1);
                }
                else {
                    unassigned.push({ name: resource.name, configPath: resource.configPath });
                }
            }
            return {
                data: {
                    stacks: [...counts.keys()].sort(byCodeUnit).map((name) => ({
                        name,
                        resourceCount: counts.get(name) ?? 0,
                    })),
                    unassigned,
                    stack,
                    assigned: options.remove ? [] : updated,
                    ...(options.remove ? { removed: updated } : {}),
                },
            };
        };
        if (discovery.resources.length === 0 && options.resources === undefined) {
            console.log(chalk.yellow("No resources discovered. Make sure you're in a project with service.json files."));
            return report();
        }
        showDetail(`Found ${formatCount(discovery.resources.length, "resource")}\n`, 0);
        if (discovery.stackNames.length > 0) {
            console.log(chalk.bold("Existing stacks:"));
            for (const name of discovery.stackNames) {
                const count = discovery.resourcesByStack.get(name)?.length || 0;
                showDetail(`${name} (${formatCount(count, "resource")})`);
            }
            console.log();
        }
        if (listRequested) {
            if (discovery.unassignedResources.length === 0) {
                showAllSatisfyCondition("resources", "already assigned to a stack");
                return report();
            }
            console.log(chalk.bold(`${formatCount(discovery.unassignedResources.length, "resource")} without a stack:`));
            for (const resource of discovery.unassignedResources) {
                showDetail(`${resource.name}`);
                showDetail(`${resource.configPath}`, 4);
            }
            return report();
        }
        // --json never prompts: it takes the same arguments as a run without a terminal.
        assertNonInteractiveInputs(stackName, options, process.stdin.isTTY === true);
        if (stackName)
            assertValid(validateStackName(stackName));
        let targetStack = options.remove ? null : stackName;
        if (!targetStack && !options.remove) {
            targetStack = await promptForStackName();
        }
        const resourcesToUpdate = discovery.unassignedResources;
        let selectedResources;
        let relocations = new Map();
        if (options.resources !== undefined) {
            ({ selectedPaths: selectedResources, relocations } = planNamedResourceUpdates(options.resources, discovery.resources, projectRoot, targetStack, options));
        }
        else {
            if (resourcesToUpdate.length === 0) {
                console.log(chalk.yellow("\nNo resources available to add to this stack."));
                return report();
            }
            const promptedResources = await promptForResources(resourcesToUpdate, targetStack);
            if (promptedResources.length === 0) {
                console.log(chalk.yellow("No resources selected. Exiting."));
                return report();
            }
            selectedResources = promptedResources;
        }
        showDetail(options.remove
            ? `\nWill remove the stack field from ${formatCount(selectedResources.length, "resource")}.`
            : `\nWill set "stack": "${targetStack}" on ${formatCount(selectedResources.length, "resource")}.`, 0);
        if (!(await confirmStackUpdate(options)))
            return report([], targetStack);
        const { assigned, changedPaths } = await writeStackAssignments({
            selectedPaths: selectedResources,
            relocations,
            resources: discovery.resources,
            projectRoot,
            targetStack,
            remove: options.remove,
        });
        console.log();
        showSuccess(`Updated ${formatCount(assigned.length, "resource")}.`);
        if (!options.remove)
            showDetail(`\nYou can now run: flisk up ${targetStack}`, 0);
        return report(assigned, targetStack, changedPaths);
    };
    if (options.json) {
        await runJsonCommand("STACK_FAILED", "flisk stack", action);
        return;
    }
    await runCommand(action);
});
