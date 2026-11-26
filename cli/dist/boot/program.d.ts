import type { Command } from "commander";
/**
 * The program the CLI parses is built from plain command specs, so `--help`, `--version`
 * and parse errors never import the generator, discovery, native-runtime or TUI graphs.
 * Only a command that actually runs loads its module: `createProgram()` imports the real
 * command tree, and its `parseAsync` sees the original argv with every option source intact.
 */
export declare function buildProgram(): Command;
