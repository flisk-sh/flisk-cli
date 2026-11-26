import { type CreateAnswers } from "../../utils/create-plan.js";
/** How to get each missing program; empty when nothing is missing or nothing is known about it. */
export declare function installHelp(missing: string[]): string[];
export interface CreateOptions {
    starter?: string;
    runtime?: string;
    frontend?: string;
    backend?: string;
    language?: string;
    extras?: string;
    yes?: boolean;
    dryRun?: boolean;
    start?: boolean;
    json?: boolean;
}
/** Whether the command may ask questions: a terminal on both ends, and no `--yes`. */
export declare function isInteractive(options: CreateOptions, tty: {
    in: boolean;
    out: boolean;
}): boolean;
/**
 * Collects the answers. A flag wins over a question, and a question is only asked for a part the chosen shape uses. Without a
 * terminal the registries' defaults fill what a flag did not.
 */
export declare function collectAnswers(nameArg: string | undefined, options: CreateOptions, interactive: boolean): Promise<CreateAnswers>;
