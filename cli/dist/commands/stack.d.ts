import { Command } from "commander";
export { parseStackResourceConfig } from "./stack/assign.js";
export { normalizeResourceNames } from "./stack/validate.js";
/**
 * What `flisk stack --json` reports: the stacks with their resource counts and the resources without a stack, both as
 * they are after the run, plus the target stack (null for --list/--remove) and the resources assigned or removed.
 */
export interface StackReport {
    stacks: {
        name: string;
        resourceCount: number;
    }[];
    unassigned: {
        name: string;
        configPath: string;
    }[];
    stack: string | null;
    assigned: {
        name: string;
        configPath: string;
    }[];
    removed?: {
        name: string;
        configPath: string;
    }[];
}
export declare const stackCommand: Command;
