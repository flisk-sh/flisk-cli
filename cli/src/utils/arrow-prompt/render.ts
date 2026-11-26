// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The renderer and prompt loop behind the arrow-key prompts: `renderMenu` and `renderAnswered` turn
 * the input model into frame rows, and `arrowSelect`, `arrowMultiSelect` and `arrowText` drive a TTY
 * stream with them. The key/frame helpers stay pure in `./input.js` and `./layout.js`, so tests drive
 * these prompts through scripted streams without a terminal.
 */

import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import {
  type ArrowChoice,
  filterChoices,
  type KeyPress,
  menuAction,
  moveIndex,
  visibleWindow,
} from "./input.js";
import { fitRow, framedLines } from "./layout.js";

/** Thrown when the person presses Ctrl-C or Escape, so the caller can stop without a stack trace. */
export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "PromptCancelled";
  }
}

/** The streams a prompt needs; process.stdin and process.stdout by default. */
export interface PromptStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

const defaultStreams = (): PromptStreams => ({ input: process.stdin, output: process.stdout });

interface MenuFrame<T extends string> {
  message: string;
  choices: readonly ArrowChoice<T>[];
  cursor: number;
  /** Multi-select: the ticked values. Undefined for a single choice. */
  ticked?: ReadonlySet<T>;
  /** The text typed to narrow a long menu; undefined when the menu does not filter. */
  filter?: string;
  /** The terminal height. A menu taller than this shows a window of its choices that follows the cursor. */
  terminalRows?: number;
}

/** The rows of a menu, plain text for the caller to colour. Pure, so the layout is testable. */
export function renderMenu<T extends string>(frame: MenuFrame<T>): string[] {
  const rows = [`${chalk.cyan("◆")} ${chalk.bold(frame.message)}`];
  if (frame.filter !== undefined) {
    rows.push(
      `${chalk.dim("│")} ${chalk.dim("filter:")} ${frame.filter || chalk.dim("type to narrow the list")}${chalk.dim("▏")}`,
    );
  }
  const [from, to] = visibleWindow(frame.choices.length, frame.cursor, frame.terminalRows);
  if (from > 0) rows.push(chalk.dim(`│   ↑ ${from} more`));
  frame.choices.slice(from, to).forEach((choice, offset) => {
    const index = from + offset;
    const active = index === frame.cursor;
    const mark = frame.ticked ? (frame.ticked.has(choice.value) ? "◼" : "◻") : active ? "●" : "○";
    const title = active ? chalk.cyan(choice.title) : chalk.dim(choice.title);
    const hint = choice.hint ? chalk.dim(`  ${choice.hint}`) : "";
    const pointer = active ? chalk.cyan("›") : " ";
    rows.push(
      `${chalk.dim("│")} ${pointer} ${active ? chalk.cyan(mark) : chalk.dim(mark)} ${title}${hint}`,
    );
  });
  if (to < frame.choices.length) rows.push(chalk.dim(`│   ↓ ${frame.choices.length - to} more`));
  rows.push(
    chalk.dim(
      frame.ticked
        ? "└ ↑/↓ move · space tick · Enter confirm"
        : frame.filter !== undefined
          ? "└ ↑/↓ move · type to filter · Enter choose"
          : "└ ↑/↓ move · Enter choose",
    ),
  );
  return rows;
}

/** The line left behind once an answer is given. */
export function renderAnswered(message: string, answer: string): string {
  return `${chalk.green("◇")} ${message}  ${chalk.dim(answer)}`;
}

/** Clears the last `lines` terminal lines the cursor is below, and puts the cursor back at the first. */
function eraseRows(output: NodeJS.WriteStream, lines: number): void {
  if (lines > 0) output.write(`\x1b[${lines}A`);
  output.write("\r\x1b[0J");
}

/** Reads keypresses until `onKey` returns a value. Raw mode and the cursor are always put back. */
function readKeys<R>(
  streams: PromptStreams,
  onKey: (key: KeyPress, str: string | undefined) => { done: R } | undefined,
): Promise<R> {
  const { input, output } = streams;
  emitKeypressEvents(input);
  const wasRaw = input.isRaw === true;
  input.setRawMode?.(true);
  input.resume();
  output.write("\x1b[?25l");

  return new Promise<R>((resolve, reject) => {
    const finish = (settle: () => void) => {
      input.off("keypress", handler);
      input.off("end", closed);
      input.off("close", closed);
      input.setRawMode?.(wasRaw);
      input.pause();
      output.write("\x1b[?25h");
      settle();
    };
    const handler = (str: string | undefined, key: KeyPress | undefined) => {
      const pressed: KeyPress = key ?? { sequence: str };
      if (menuAction(pressed) === "cancel") {
        finish(() => reject(new PromptCancelled()));
        return;
      }
      const result = onKey(pressed, str);
      if (result) finish(() => resolve(result.done));
    };
    // A closed input (a pipe that ended, a detached terminal) can never answer: cancel instead of waiting forever.
    const closed = () => finish(() => reject(new PromptCancelled()));
    input.on("keypress", handler);
    input.once("end", closed);
    input.once("close", closed);
  });
}

/** Pick one: arrows to move, Enter to choose. With `filterable`, typing narrows a long list. */
export async function arrowSelect<T extends string>(
  options: {
    message: string;
    choices: readonly ArrowChoice<T>[];
    initial?: T;
    filterable?: boolean;
  },
  streams: PromptStreams = defaultStreams(),
): Promise<T> {
  const { output } = streams;
  let filter = "";
  let cursor = Math.max(
    0,
    options.choices.findIndex((choice) => choice.value === options.initial),
  );
  // The choices visible right now: the filter narrows them when the menu is filterable.
  const visible = () =>
    options.filterable ? filterChoices(options.choices, filter) : options.choices;
  let drawn = 0;
  // Overwrites the menu in place: erases exactly the lines the last frame printed, then draws again.
  const draw = () => {
    eraseRows(output, drawn);
    const shown = visible();
    cursor = Math.min(cursor, Math.max(0, shown.length - 1));
    const rows = renderMenu({
      message: options.message,
      choices: shown,
      cursor,
      ...(options.filterable ? { filter } : {}),
      terminalRows: output.rows,
    });
    if (shown.length === 0)
      rows.splice(
        options.filterable ? 2 : 1,
        0,
        chalk.dim("│   nothing matches · Backspace clears what you typed"),
      );
    const width = output.columns ?? 80;
    const fitted = rows.map((row) => fitRow(row, width));
    output.write(`${fitted.join("\n")}\n`);
    drawn = framedLines(fitted, width);
  };
  draw();
  try {
    const chosen = await readKeys<T>(streams, (key, str) => {
      const action = menuAction(key);
      const shown = visible();
      // In a filtering menu the letters belong to the filter, so only the arrows move.
      const typed = options.filterable && str && str.length === 1 && str >= " " && !key.ctrl;
      if (options.filterable && key.name === "backspace") {
        filter = filter.slice(0, -1);
        draw();
        return undefined;
      }
      if (typed && action !== "submit") {
        filter += str;
        cursor = 0;
        draw();
        return undefined;
      }
      if (action === "up" || action === "down") {
        cursor = moveIndex(cursor, shown.length, action === "up" ? -1 : 1);
        draw();
      }
      const current = shown[cursor];
      return action === "submit" && current ? { done: current.value } : undefined;
    });
    eraseRows(output, drawn);
    const picked = options.choices.find((choice) => choice.value === chosen);
    output.write(`${renderAnswered(options.message, picked?.title ?? chosen)}\n`);
    return chosen;
  } catch (error) {
    eraseRows(output, drawn);
    throw error;
  }
}

/** Pick any number: arrows to move, space to tick, Enter to confirm (nothing ticked is fine). */
export async function arrowMultiSelect<T extends string>(
  options: { message: string; choices: readonly ArrowChoice<T>[] },
  streams: PromptStreams = defaultStreams(),
): Promise<T[]> {
  const { output } = streams;
  let cursor = 0;
  const ticked = new Set<T>(
    options.choices.filter((choice) => choice.selected).map((choice) => choice.value),
  );
  let drawn = 0;
  // Overwrites the tick list in place: erases exactly the lines the last frame printed, then draws again.
  const draw = () => {
    eraseRows(output, drawn);
    const rows = renderMenu({
      message: options.message,
      choices: options.choices,
      cursor,
      ticked,
      terminalRows: output.rows,
    });
    const width = output.columns ?? 80;
    const fitted = rows.map((row) => fitRow(row, width));
    output.write(`${fitted.join("\n")}\n`);
    drawn = framedLines(fitted, width);
  };
  draw();
  try {
    await readKeys<true>(streams, (key) => {
      const action = menuAction(key);
      const current = options.choices[cursor];
      if (action === "up" || action === "down") {
        cursor = moveIndex(cursor, options.choices.length, action === "up" ? -1 : 1);
        draw();
      } else if (action === "toggle" && current) {
        if (ticked.has(current.value)) ticked.delete(current.value);
        else ticked.add(current.value);
        draw();
      }
      return action === "submit" ? { done: true } : undefined;
    });
    eraseRows(output, drawn);
    const titles = options.choices.filter((c) => ticked.has(c.value)).map((c) => c.title);
    output.write(
      `${renderAnswered(options.message, titles.length ? titles.join(", ") : "none")}\n`,
    );
    return options.choices.filter((c) => ticked.has(c.value)).map((c) => c.value);
  } catch (error) {
    eraseRows(output, drawn);
    throw error;
  }
}

/** A line of text with a default: press Enter to take it, or type to replace it. */
export async function arrowText(
  options: { message: string; initial: string; validate?: (value: string) => true | string },
  streams: PromptStreams = defaultStreams(),
): Promise<string> {
  const { output } = streams;
  let typed = "";
  let problem = "";
  let drawn = 0;
  // Overwrites the name line in place: erases exactly the lines the last frame printed, then draws again.
  const draw = () => {
    eraseRows(output, drawn);
    const shown = typed.length > 0 ? chalk.cyan(typed) : chalk.dim(options.initial);
    const rows = [
      `${chalk.cyan("◆")} ${chalk.bold(options.message)}  ${shown}${chalk.dim("▏")}`,
      problem ? chalk.red(`│ ${problem}`) : chalk.dim("└ Enter to accept, or type a name"),
    ];
    const width = output.columns ?? 80;
    const fitted = rows.map((row) => fitRow(row, width));
    output.write(`${fitted.join("\n")}\n`);
    drawn = framedLines(fitted, width);
  };
  draw();
  try {
    const value = await readKeys<string>(streams, (key, str) => {
      const action = menuAction(key);
      if (action === "submit") {
        const candidate = typed.length > 0 ? typed : options.initial;
        const verdict = options.validate?.(candidate) ?? true;
        if (verdict === true) return { done: candidate };
        problem = verdict;
        draw();
        return undefined;
      }
      if (key.name === "backspace") {
        typed = typed.slice(0, -1);
      } else if (str && str.length === 1 && str >= " " && !key.ctrl) {
        typed += str;
      } else {
        return undefined;
      }
      problem = "";
      draw();
      return undefined;
    });
    eraseRows(output, drawn);
    output.write(`${renderAnswered(options.message, value)}\n`);
    return value;
  } catch (error) {
    eraseRows(output, drawn);
    throw error;
  }
}
