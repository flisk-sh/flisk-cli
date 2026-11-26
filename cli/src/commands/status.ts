// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { Command } from "commander";
import { attachNoPositionalHint } from "../utils/command-helpers.js";
import { addProjectOption } from "../utils/project-resolution.js";
import { statusAction } from "./status/action.js";

// `strictNotReady` keeps its old import path for callers of "./status.js".
export { strictNotReady } from "./status/not-ready.js";

export const statusCommand = addProjectOption(
  attachNoPositionalHint(new Command("status")),
  "status",
)
  .description("Show status of resources and stacks")
  .option("--json", "Output a versioned JSON status report", false)
  .option("-v, --verbose", "Show detailed information", false)
  .option("--stacks", "Show stack information", true)
  .option("--stack <name>", "Only report services in this stack")
  .option("--resources", "Show all discovered resources", false)
  .option("--tilt", "Show Tilt resource status (Docker/Tilt stacks only)", false)
  .option("--no-gateway", "Disable gateway status reporting")
  .option("--unhealthy", "Show only services that are failing or still starting", false)
  .option("--strict", "Exit 1 when any service is not ready or nothing is running", false)
  .option("--usage", "Show CPU, memory and process usage per service", false)
  .addHelpText(
    "after",
    "\nExamples:\n  flisk status\n  flisk status --resources\n  flisk status --unhealthy\n  flisk status --usage\n  flisk status --json\n  flisk status --strict",
  )
  .action(async (options, command: Command) => {
    await statusAction(options, command);
  });
