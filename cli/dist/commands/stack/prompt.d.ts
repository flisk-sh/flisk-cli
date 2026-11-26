import type { DiscoveredResource } from "../../types/index.js";
/** The `promptText` contract this flow needs; injectable so tests script the answers. */
export type StackNamePrompt = (options: {
    message: string;
    validate?: (input: string) => true | string;
}) => Promise<string>;
/** The `promptMultiSelect` contract this flow needs. */
export type ResourcePickPrompt = (options: {
    message: string;
    choices: {
        title: string;
        value: string;
    }[];
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
export declare function validatePromptedStackName(input: string): true | string;
/** Ask for the target stack name when the invocation carried no positional. */
export declare function promptForStackName(ask?: StackNamePrompt): Promise<string>;
/** Multi-select the unassigned resources to update; returns their service.json paths. */
export declare function promptForResources(unassigned: DiscoveredResource[], targetStack: string | null, ask?: ResourcePickPrompt): Promise<string[]>;
/** `--yes` and `--json` pre-answer the confirmation; anything else asks. */
export declare function confirmStackUpdate(options: {
    yes?: boolean;
    json?: boolean;
}, ask?: ConfirmPrompt): Promise<boolean>;
