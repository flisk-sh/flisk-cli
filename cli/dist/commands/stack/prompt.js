// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { confirmOrCancel } from "../../utils/command-helpers.js";
import { promptMultiSelect, promptText } from "../../utils/prompt.js";
import { createKebabCaseValidator } from "../../utils/validation.js";
/**
 * Stack-name rules applied to a prompted answer. The positional check never
 * sees this value: `--resources` without a stack name asks for it here, so
 * "list" has to be refused from the prompt too or the run stores a stack that
 * `flisk stack --list` can no longer address.
 */
export function validatePromptedStackName(input) {
    if (input.trim().toLowerCase() === "list") {
        return '"list" is reserved for listing stacks. Use: flisk stack --list';
    }
    const validation = createKebabCaseValidator("stack")(input);
    return validation === true || validation;
}
/** Ask for the target stack name when the invocation carried no positional. */
export async function promptForStackName(ask = promptText) {
    return ask({
        message: "Stack name (kebab-case recommended):",
        validate: validatePromptedStackName,
    });
}
/** Multi-select the unassigned resources to update; returns their service.json paths. */
export async function promptForResources(unassigned, targetStack, ask = promptMultiSelect) {
    return ask({
        message: `Select resources to add to stack "${targetStack}":`,
        choices: unassigned.map((resource) => ({
            title: resource.name,
            value: resource.configPath,
        })),
        validate: (input) => {
            if (input.length === 0)
                return "Select at least one resource";
            return true;
        },
    });
}
/** `--yes` and `--json` pre-answer the confirmation; anything else asks. */
export async function confirmStackUpdate(options, ask = confirmOrCancel) {
    return options.yes || options.json || (await ask("Proceed?"));
}
