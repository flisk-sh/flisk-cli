/**
 * Runs `flisk completion` through the root program, the way the CLI does.
 *
 * The completion command reads the commands and flags from the program it is registered on, so it
 * has to run inside that program to produce the real script.
 */
export declare function runCompletionCommand(args: string[]): Promise<void>;
