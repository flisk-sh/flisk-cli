/**
 * Makes the global `--verbose` real before Commander parses argv (#3890).
 *
 * The root program declares `--verbose`, but with positional options a root flag binds only
 * before the subcommand, and most commands do not declare one, so `flisk networks --verbose`
 * died with "unknown option" while `flisk --verbose networks` was accepted and ignored.
 * Every `--verbose` before `--` now sets FLISK_VERBOSE for the commands that read the
 * variable, and an occurrence the resolved command cannot accept leaves argv before the
 * spec program parses. One a command declares itself (`flisk status --verbose`) is kept so
 * the command still reads its own flag.
 */
import type { CommandSpec } from "../commands/command-specs.js";
export interface VerboseArgv {
    /** `args` with the `--verbose` tokens removed that the resolved command would reject. */
    args: string[];
    /** `--verbose` appeared somewhere before `--`. */
    verbose: boolean;
}
/**
 * Scans the user arguments (everything after the executable and script). When `verbose` is
 * true the caller turns on FLISK_VERBOSE; `args` is what Commander then parses.
 */
export declare function applyGlobalVerboseFlag(args: readonly string[], specs: readonly CommandSpec[]): VerboseArgv;
