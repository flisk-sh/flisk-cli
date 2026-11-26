import type { Command } from "commander";
import { type MockInstance } from "vitest";
export interface JsonCommandCapture {
    /** The `process.exit` spy; only valid inside `inspect`, before the spies are restored. */
    exit: MockInstance;
    /** Raw `console.log` lines captured from the command. */
    lines: string[];
}
/**
 * Runs a Commander command that prints a JSON envelope, capturing its output and exit spy. `inspect` can assert on
 * them while the spies are still live; all spies are restored before the function returns.
 */
export declare function captureJsonCommand(command: Command, args: string[], inspect?: (capture: JsonCommandCapture) => void | Promise<void>): Promise<{
    lines: string[];
}>;
