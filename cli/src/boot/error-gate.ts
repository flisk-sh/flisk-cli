// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import chalk from "chalk";
import type { Command } from "commander";
import { showDemoHelp, showHelp } from "../commands/help.js";
import type { DemoRootOptions } from "../utils/demo-args.js";
import { resolveHelpTarget } from "../utils/help-command.js";

/**
 * The early gates of the one-command flow, each answered before any setup runs.
 *
 * Help is answered before anything may be stopped or deleted (`flisk --template=demo --help`);
 * the demo flow has its own flags, so `flisk demo --help` lists them instead of the global
 * command table. An option the flow does not read (e.g. `--dry-run`) is refused like Commander
 * does, before anything is fetched, written or started (#4487). A bad `--project` value is
 * refused the same way.
 *
 * @returns The exit code when a gate ended the run, or `undefined` to continue booting.
 */
export function checkRootOptionGates(rootOptions: DemoRootOptions): number | undefined {
  const templateArg = rootOptions.template;
  if (templateArg && rootOptions.help) {
    if (templateArg === "demo") showDemoHelp();
    else showHelp();
    return 0;
  }
  if (templateArg && rootOptions.unknownOption) {
    console.error(chalk.red(`error: unknown option '${rootOptions.unknownOption}'`));
    return 1;
  }
  if (templateArg && rootOptions.projectError) {
    console.error(chalk.red(`❌ ${rootOptions.projectError}`));
    return 1;
  }
  return undefined;
}

/**
 * Native Windows cannot boot a stack, so the one-command flow refuses before it clones a
 * template, installs the CLI globally or writes into the home directory.
 *
 * @returns 1 when the platform is refused, or `undefined` to continue.
 */
export async function checkPlatformGate(
  platform: string = process.platform,
  allowNativeWindows: string | undefined = process.env.FLISK_ALLOW_NATIVE_WINDOWS,
): Promise<number | undefined> {
  const { nativeWindowsStackRefusal } = await import("../utils/native-windows.js");
  const platformRefusal = nativeWindowsStackRefusal(platform, allowNativeWindows);
  if (!platformRefusal) return undefined;
  console.error(chalk.red(`❌ ${platformRefusal}`));
  console.error(
    chalk.gray(
      "   Run it from Ubuntu in WSL2. Guide: docs/start-here-on-windows.md (reference: docs/wsl2.md)",
    ),
  );
  return 1;
}

/**
 * Docker on Colima is only usable while the VM is up, and a stopped VM looks like a broken
 * Docker daemon. Say so before the long wait instead of after it.
 *
 * @returns 1 when Colima is present but stopped, or `undefined` to continue.
 */
export async function checkColimaGate(): Promise<number | undefined> {
  const { checkColimaAsync } = await import("../utils/colima.js");
  const colima = await checkColimaAsync();
  if (!colima.isColima || colima.running) return undefined;
  console.log(chalk.yellow(colima.problem ?? "The Colima VM is not running."));
  console.log(chalk.gray(`  Fix: ${colima.fix ?? "colima start"}`));
  return 1;
}

/**
 * The gates between the demo flow and `program.parseAsync()`: `--doctor` aliases the `doctor`
 * command, a lone help flag prints the command table, and `flisk help demo` uses the demo help
 * (`demo` is handled before Commander, so it is not in the program tree `flisk help demo`
 * searches, #3743). `flisk help <cmd> <sub>` resolves across nested subcommands.
 *
 * An unknown help target fails through `program.error` and a resolved nested target prints its
 * help; both let Commander end the process, matching the plain command paths.
 *
 * @returns The exit code when a gate printed help and ended the run, or `undefined` to continue
 *          to `parseAsync`.
 */
export function checkHelpGates(argv: string[], program: Command): number | undefined {
  if (argv[2] === "--doctor") argv[2] = "doctor";

  const helpArg = argv[2];
  if (argv.length === 3 && helpArg && ["-h", "--help", "help"].includes(helpArg)) {
    showHelp();
    return 0;
  }

  const helpArgs = argv.slice(2);
  if (helpArgs[0] === "help" && helpArgs[1] === "demo" && helpArgs.length === 2) {
    showDemoHelp();
    return 0;
  }

  const helpResolved = resolveHelpTarget(helpArgs, program.commands);
  if (helpResolved.unknown) {
    program.error(`error: unknown command '${helpResolved.unknown}'`, {
      exitCode: 1,
      code: "commander.unknownCommand",
    });
  }
  if (helpResolved.depth >= 2 && helpResolved.command) {
    helpResolved.command.help();
  }
  return undefined;
}
