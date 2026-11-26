// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { delimiter, isAbsolute } from "node:path";

/**
 * The "which program does this command run" preflight behind `findMissingPrograms`: a command line is read
 * the way the shell reads it, word by word, so a missing program can be named before the run starts.
 * Internal to the native runtime: `plan.ts` is the only caller.
 */

/** Shell keywords that begin a compound command; which program runs inside is the shell's grammar, not a word. */
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "coproc",
  "function",
  "time",
  "{",
  "}",
  "!",
  "[[",
  "]]",
]);

/** Shell builtins that run before the program we care about, so they never name what is missing. */
const SHELL_BUILTINS = new Set([
  ":",
  "true",
  "false",
  "cd",
  "export",
  "set",
  "unset",
  "local",
  "readonly",
  "declare",
  "typeset",
  "shift",
  "umask",
  "ulimit",
  "trap",
  "eval",
  "alias",
  "unalias",
  "hash",
  "command",
  "builtin",
  "type",
  "times",
  "wait",
  "exit",
  "return",
  "break",
  "continue",
  "echo",
  "printf",
  "test",
  "[",
  "read",
  "pwd",
  "jobs",
  "kill",
  "getopts",
  "fc",
]);

/** Builtins that can repoint PATH or define a function, so which program runs after them cannot be told here. */
const UNMODELLED_BUILTINS = new Set([".", "source"]);

/** Marker for a segment whose program this preflight cannot name, so the shell is left to report it. */
const UNRESOLVED = Symbol("unresolved");

/** A command word after quote removal, and whether it carries an expansion (`$VAR`, `` `cmd` ``) we cannot resolve. */
type CommandWord = { text: string; expansion: boolean };

/**
 * Splits a command into `&&`/`;` separated segments of words the way the shell does it (#3885 review): a separator
 * inside quotes or escaped by a backslash is part of the argument, not a separator. Returns null for syntax whose
 * program this preflight cannot tell — a pipe, a redirection, a background job, an unterminated quote.
 */
function shellSegments(command: string): CommandWord[][] | null {
  const segments: CommandWord[][] = [[]];
  let word = "";
  let expansion = false;
  let started = false;
  const push = () => {
    const segment = segments[segments.length - 1];
    if (started && segment) segment.push({ text: word, expansion });
    word = "";
    expansion = false;
    started = false;
  };
  let i = 0;
  while (i < command.length) {
    const char = command.charAt(i);
    i += 1;
    if (char === "'") {
      const end = command.indexOf("'", i);
      if (end === -1) return null;
      word += command.slice(i, end);
      started = true;
      i = end + 1;
      continue;
    }
    if (char === '"') {
      let end = i;
      let closed = false;
      while (end < command.length) {
        const inner = command.charAt(end);
        if (inner === "\\" && end + 1 < command.length) {
          word += command[end + 1];
          end += 2;
          continue;
        }
        if (inner === '"') {
          closed = true;
          break;
        }
        if (inner === "$" || inner === "`") expansion = true;
        word += inner;
        end += 1;
      }
      if (!closed) return null;
      started = true;
      i = end + 1;
      continue;
    }
    if (char === "\\") {
      if (i >= command.length) return null;
      word += command[i];
      started = true;
      i += 1;
      continue;
    }
    if (char === "$" || char === "`") {
      expansion = true;
      word += char;
      started = true;
      continue;
    }
    if (char === " " || char === "\t") {
      push();
      continue;
    }
    // An unquoted `#` at the start of a word begins a comment: the shell never runs what follows.
    if (char === "#" && !started) break;
    if (char === "\n") return null;
    if (char === "&") {
      if (command[i] !== "&") return null;
      push();
      segments.push([]);
      i += 1;
      continue;
    }
    if (char === ";") {
      push();
      segments.push([]);
      continue;
    }
    if (char === "|" || char === "(" || char === ")" || char === "<" || char === ">") return null;
    word += char;
    started = true;
  }
  push();
  return segments;
}

/** True when the command sets PATH itself (`PATH=/opt/bin`, `export PATH=…`, `env PATH=…`). */
function assignsPath(words: readonly CommandWord[]): boolean {
  return words.some((word) => /^PATH=/.test(word.text));
}

/** `env` options that stand alone: none of them takes an argument, and none is the program (#4676 review). */
const ENV_STANDALONE_OPTIONS = new Set([
  "-",
  "-i",
  "--ignore-environment",
  "-0",
  "--null",
  "-v",
  "--debug",
]);

/** `env` options whose value is the next word (`-u HOME`), or the rest of their own word (`-uHOME`, `--unset=HOME`). */
const ENV_VALUE_OPTIONS = new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);
const ENV_INLINE_VALUE_OPTION = /^(?:-[uCS].+|--(?:unset|chdir|split-string)=.+)$/;

/** The program one segment starts, null when it only runs builtins, or UNRESOLVED when it cannot be told. */
function segmentProgram(words: readonly CommandWord[]): string | null | typeof UNRESOLVED {
  // `env` picks the program itself, after its own options and `NAME=VALUE` assignments; an option this preflight does
  // not know is left to env rather than reported as a program that is missing (#4676 review).
  let inEnv = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    // Leading VAR=value assignments set the program's environment, and `exec` chooses it; neither is the program.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text)) continue;
    if (word.text === "exec") continue;
    if (word.text === "env") {
      inEnv = true;
      continue;
    }
    if (inEnv) {
      if (word.text === "--") {
        inEnv = false;
        continue;
      }
      if (ENV_STANDALONE_OPTIONS.has(word.text)) continue;
      if (ENV_VALUE_OPTIONS.has(word.text)) {
        index += 1;
        continue;
      }
      if (ENV_INLINE_VALUE_OPTION.test(word.text)) continue;
      if (word.text.startsWith("-")) return UNRESOLVED;
      inEnv = false;
    }
    if (SHELL_BUILTINS.has(word.text)) return null;
    if (word.expansion) return UNRESOLVED;
    return /^[A-Za-z0-9_./@+-]+$/.test(word.text) ? word.text : UNRESOLVED;
  }
  return null;
}

/**
 * The program a command really starts. A setup job of a generated starter declares `cd ../agent && npm install`
 * (#3885), whose first word is the shell builtin `cd`; what fails on a machine without `npm` is the word after it.
 *
 * The command is read the way the shell reads it: `&&` and `;` inside quotes or escaped are arguments, `export` and
 * the other builtins run before the program, and a compound command (`if … then … fi`), a pipe, a redirection or a
 * sourced script — anything whose program this word-by-word view cannot name — is left for the shell to report rather
 * than guessed at.
 */
export function leadingProgram(command: string): { program: string; moved: boolean } | null {
  const segments = shellSegments(command);
  if (!segments) return null;
  let moved = false;
  for (const words of segments) {
    if (words.length === 0) continue;
    const first = words[0];
    if (!first) continue;
    if (SHELL_KEYWORDS.has(first.text) || UNMODELLED_BUILTINS.has(first.text)) return null;
    if (assignsPath(words)) return null;
    const program = segmentProgram(words);
    if (program === UNRESOLVED) return null;
    if (program === null) {
      if (words.some((word) => word.text === "cd")) moved = true;
      continue;
    }
    return { program, moved };
  }
  return null;
}

/** True when PATH has an entry that is not absolute, which the shell resolves against its current directory. */
export function pathHasRelativeEntry(): boolean {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  return pathEnv.split(delimiter).some((entry) => entry !== "" && !isAbsolute(entry));
}
