#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import "./utils/env-compat-init.js";
import "./utils/engine-env-init.js";
import pkg from "../package.json" with { type: "json" };
import { runDemoBootstrap } from "./boot/demo.js";
import { checkHelpGates, checkRootOptionGates } from "./boot/error-gate.js";
import { runFirstRunMigration } from "./boot/first-run.js";
import { buildProgram } from "./boot/program.js";
import { COMMAND_SPECS } from "./commands/command-specs.generated.js";
import { parseDemoRootOptions } from "./utils/demo-args.js";
import { handleCommandError } from "./utils/errors.js";
import { cleanupRunningBinaryArtifacts } from "./utils/upgrade-cleanup.js";
import { applyGlobalVerboseFlag } from "./utils/verbose-flag.js";
// Remove any deferred Windows self-upgrade artifacts left when the prior binary exited.
cleanupRunningBinaryArtifacts();
// The root program declares `--verbose`, but a root flag binds only before the subcommand
// and most commands do not declare one, so `flisk networks --verbose` died with
// "unknown option" while `flisk --verbose networks` was accepted and ignored (#3890).
// Read every `--verbose` before `--` here: it turns on FLISK_VERBOSE for the commands that
// read the variable, and the tokens the resolved command would reject leave argv before
// the spec program parses. A `--verbose` a command declares itself stays for it to read.
const verboseScan = applyGlobalVerboseFlag(process.argv.slice(2), COMMAND_SPECS);
if (verboseScan.verbose)
    process.env.FLISK_VERBOSE = "1";
process.argv.splice(2, process.argv.length - 2, ...verboseScan.args);
const program = buildProgram();
// Every boot phase reports how it ended and this tail owns the single process.exit. A phase that
// returns undefined means boot continues: no bare invocation, no template, no help target.
let code = await runFirstRunMigration(process.argv);
if (code === undefined) {
    const rootOptions = parseDemoRootOptions(process.argv);
    code =
        checkRootOptionGates(rootOptions) ??
            (await runDemoBootstrap({ argv: process.argv, rootOptions, version: pkg.version })) ??
            checkHelpGates(process.argv, program);
}
if (code !== undefined)
    process.exit(code);
// An async action that throws (a corrupt project.json read deep inside a command) used to end as an unhandled rejection with a
// raw runtime stack trace; every command now fails with one error line.
program.parseAsync().catch(handleCommandError);
