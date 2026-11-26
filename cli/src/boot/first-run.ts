// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The bare `flisk` run is a new user's first contact: report the machine checks and the next
 * commands, then end the boot with the preflight result. Any other argv shape continues booting.
 *
 * @returns The exit code for a bare invocation, or `undefined` when boot should continue.
 */
export async function runFirstRunMigration(argv: readonly string[]): Promise<number | undefined> {
  // Default: show help if no command provided
  if (argv.length !== 2) return undefined;
  const { formatColdPreflight, runColdPreflight } = await import("../utils/cold-preflight.js");
  const result = await runColdPreflight();
  console.log(formatColdPreflight(result));
  console.log("\nCommands: flisk doctor | flisk project --yes | flisk --help");
  console.log("\nOne command from scratch (clones, boots and opens the browser):");
  console.log(
    `  npx -y @flisk-sh/flisk@latest demo   (no Docker? it runs a small demo as local processes)`,
  );
  console.log(`  npx -y @flisk-sh/flisk@latest restaurant --project=my-stack`);
  return result.ok ? 0 : 1;
}
