// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { COMMAND_SPECS } from "../commands/command-specs.generated.js";
import { createSpecProgram } from "../commands/command-specs.js";
/**
 * The program the CLI parses is built from plain command specs, so `--help`, `--version`
 * and parse errors never import the generator, discovery, native-runtime or TUI graphs.
 * Only a command that actually runs loads its module: `createProgram()` imports the real
 * command tree, and its `parseAsync` sees the original argv with every option source intact.
 */
export function buildProgram() {
    return createSpecProgram(COMMAND_SPECS, async (spec) => {
        const { runLazyCommand } = await import("../commands/lazy-command.js");
        await runLazyCommand(spec, process.argv.slice(2));
    });
}
