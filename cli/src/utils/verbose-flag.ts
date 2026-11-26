// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
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
import type { CommandOptionSpec, CommandSpec } from "../commands/command-specs.js";

/** The root program's value-taking options, so a value is not mistaken for a subcommand. */
const ROOT_OPTIONS: readonly CommandOptionSpec[] = [
  { flags: "--verbose", description: "" },
  { flags: "--template <name>", description: "" },
  { flags: "--project <dir>", description: "" },
];

/** What consumes the rest of argv once the first operand is not a known subcommand. */
const DEAD_END: ParseContext = { options: [], subcommands: [], acceptsVerbose: false };

interface ParseContext {
  options: readonly CommandOptionSpec[];
  subcommands: readonly CommandSpec[];
  /** True while this command binds `--verbose` itself, so the token stays in argv. */
  acceptsVerbose: boolean;
}

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
export function applyGlobalVerboseFlag(
  args: readonly string[],
  specs: readonly CommandSpec[],
): VerboseArgv {
  let context: ParseContext = {
    options: ROOT_OPTIONS,
    subcommands: specs,
    acceptsVerbose: true,
  };
  // The first operand at each level may dispatch to a subcommand (commander's operands[0]
  // rule); after it the level's commands are decided and no deeper dispatch can happen.
  let open = true;
  let verbose = false;
  const kept: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    if (token === "--") {
      // Everything after `--` belongs to the command it invokes (`flisk run x -- tool --verbose`).
      kept.push(...args.slice(index));
      break;
    }
    if (token === "--verbose") {
      verbose = true;
      if (context.acceptsVerbose) kept.push(token);
      continue;
    }
    kept.push(token);
    if (token.startsWith("-") && token !== "-") {
      // An option: skip its value so `flisk --project networks status --verbose` still
      // resolves `status`. A following flag means the value is missing, which is
      // commander's error to report, not a value to skip.
      const next = args[index + 1];
      if (
        !token.includes("=") &&
        next !== undefined &&
        !next.startsWith("-") &&
        takesOptionValue(context.options, token)
      ) {
        kept.push(next);
        index += 1;
      }
      continue;
    }
    if (open) {
      open = false;
      const sub = context.subcommands.find(
        (candidate) => candidate.name === token || candidate.aliases.includes(token),
      );
      if (sub) {
        context = {
          options: sub.options,
          subcommands: sub.subcommands,
          acceptsVerbose: declaresVerbose(sub.options),
        };
        open = sub.subcommands.length > 0;
      } else if (context.subcommands.length > 0) {
        // A word that is not a subcommand ends the run of global root options: the root
        // accepts `--verbose` only before the first operand, so what follows it is not
        // bound to the root flag either.
        context = DEAD_END;
      }
      // A leaf command keeps its own options live for operands and flags that come later.
    }
  }
  return { args: kept, verbose };
}

/** True when the command declares `--verbose` itself (`-v, --verbose` or `--verbose`). */
function declaresVerbose(options: readonly CommandOptionSpec[]): boolean {
  return options.some((option) => optionNameMatches(option, "--verbose"));
}

/** True when `token` names one of the command's options that takes a value (`--stack <name>`). */
function takesOptionValue(options: readonly CommandOptionSpec[], token: string): boolean {
  return options.some(
    (option) =>
      optionNameMatches(option, token) &&
      (option.flags.includes("<") || option.flags.includes("[")),
  );
}

/** True when `token` is one of the option's spellings, without its `=value` or `<value>` part. */
function optionNameMatches(option: CommandOptionSpec, token: string): boolean {
  const name = token.split("=", 1)[0];
  return option.flags
    .split(",")
    .map((flag) => flag.trim().split(/\s+/, 1)[0])
    .includes(name);
}
