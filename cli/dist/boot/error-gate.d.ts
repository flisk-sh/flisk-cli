import type { Command } from "commander";
import type { DemoRootOptions } from "../utils/demo-args.js";
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
export declare function checkRootOptionGates(rootOptions: DemoRootOptions): number | undefined;
/**
 * Native Windows cannot boot a stack, so the one-command flow refuses before it clones a
 * template, installs the CLI globally or writes into the home directory.
 *
 * @returns 1 when the platform is refused, or `undefined` to continue.
 */
export declare function checkPlatformGate(platform?: string, allowNativeWindows?: string | undefined): Promise<number | undefined>;
/**
 * Docker on Colima is only usable while the VM is up, and a stopped VM looks like a broken
 * Docker daemon. Say so before the long wait instead of after it.
 *
 * @returns 1 when Colima is present but stopped, or `undefined` to continue.
 */
export declare function checkColimaGate(): Promise<number | undefined>;
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
export declare function checkHelpGates(argv: string[], program: Command): number | undefined;
