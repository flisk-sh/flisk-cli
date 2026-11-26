// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { DiscoveredResource } from "../../types/index.js";
import { confirmOrCancel } from "../../utils/command-helpers.js";
import { promptMultiSelect, promptText } from "../../utils/prompt.js";
import { createKebabCaseValidator } from "../../utils/validation.js";

/** The `promptText` contract this flow needs; injectable so tests script the answers. */
export type StackNamePrompt = (options: {
  message: string;
  validate?: (input: string) => true | string;
}) => Promise<string>;

/** The `promptMultiSelect` contract this flow needs. */
export type ResourcePickPrompt = (options: {
  message: string;
  choices: { title: string; value: string }[];
  validate?: (input: string[]) => true | string;
}) => Promise<string[]>;

/** The `confirmOrCancel` contract this flow needs. */
export type ConfirmPrompt = (message: string) => Promise<boolean>;

/**
 * Stack-name rules applied to a prompted answer. The positional check never
 * sees this value: `--resources` without a stack name asks for it here, so
 * "list" has to be refused from the prompt too or the run stores a stack that
 * `flisk stack --list` can no longer address.
 */
export function validatePromptedStackName(input: string): true | string {
  if (input.trim().toLowerCase() === "list") {
    return '"list" is reserved for listing stacks. Use: flisk stack --list';
  }
  const validation = createKebabCaseValidator("stack")(input);
  return validation === true || validation;
}

/** Ask for the target stack name when the invocation carried no positional. */
export async function promptForStackName(ask: StackNamePrompt = promptText): Promise<string> {
  return ask({
    message: "Stack name (kebab-case recommended):",
    validate: validatePromptedStackName,
  });
}

/** Multi-select the unassigned resources to update; returns their service.json paths. */
export async function promptForResources(
  unassigned: DiscoveredResource[],
  targetStack: string | null,
  ask: ResourcePickPrompt = promptMultiSelect,
): Promise<string[]> {
  return ask({
    message: `Select resources to add to stack "${targetStack}":`,
    choices: unassigned.map((resource) => ({
      title: resource.name,
      value: resource.configPath,
    })),
    validate: (input: string[]) => {
      if (input.length === 0) return "Select at least one resource";
      return true;
    },
  });
}

/** `--yes` and `--json` pre-answer the confirmation; anything else asks. */
export async function confirmStackUpdate(
  options: { yes?: boolean; json?: boolean },
  ask: ConfirmPrompt = confirmOrCancel,
): Promise<boolean> {
  return options.yes || options.json || (await ask("Proceed?"));
}
