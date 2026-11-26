import { type CreateAnswers, type CreateStep } from "../../utils/create-plan.js";
/** A service `flisk resource --local` wrote: where it lives, how to install it, and how it starts. */
export interface GeneratedService {
    dir: string;
    /** The install command, or the generator's own hint for a language without a package.json. */
    install?: string;
    run: string;
    port?: number;
}
/** The install command without the "# optional: Docker builds the image" note: on your computer the install is needed. */
export declare function localInstallHint(hint: string): string;
/** The last lines of a failed command's output, in the order the tool printed them. */
export declare function commandFailureTail(output: string, maxLines?: number): string;
/** Advice that fits what the tool actually said, instead of promising a retry can fix it. */
export declare function installFailureSuggestions(label: string, output: string, projectName: string, serviceDir: string): string[];
/** The local services a project actually contains, read from the files the generators wrote. */
export declare function generatedServices(projectDir: string, answers: CreateAnswers): GeneratedService[];
/** The first port a starter's services declare, so the next steps can say where to look. */
export declare function firstPort(projectDir: string): number | undefined;
/** Where to look once it runs: the website's page, or the API's health check when there is no website. */
export declare function whereToOpen(services: GeneratedService[]): string | undefined;
/** The commands to run next, from what was generated. */
export declare function nextSteps(projectDir: string, answers: CreateAnswers, services?: GeneratedService[]): string[];
/** What to tell someone when a step fails halfway: what finished, what did not run, how to start over. */
export declare function recoveryMessage(projectDir: string, steps: CreateStep[], failedIndex: number, createdFolder?: boolean): string[];
