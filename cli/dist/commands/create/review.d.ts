import { type CreateAnswers, type CreateStep } from "../../utils/create-plan.js";
/** What gets created, what it needs, and what was chosen, shown before anything is written. */
export declare function reviewLines(answers: CreateAnswers, steps: CreateStep[], onPath?: (program: string) => boolean): string[];
/**
 * Prints the review before anything is written, in every mode, so a default is never a surprise.
 * An interactive run also asks "Create it?", but only when the user made a non-default choice:
 * pressing Enter through everything already said yes. Returns false when the user cancels.
 */
export declare function confirmCreate(answers: CreateAnswers, steps: CreateStep[], interactive: boolean): Promise<boolean>;
