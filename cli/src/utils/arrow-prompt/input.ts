// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The input model behind the arrow-key prompts: what a keypress means, how the highlight moves,
 * which choices a filter keeps and which slice of a long menu is on screen. Every function is pure,
 * so a test drives the whole state machine from plain fixtures.
 */

/** One keypress, in the shape Node's readline emits. */
export interface KeyPress {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

export interface ArrowChoice<T extends string> {
  title: string;
  value: T;
  /** Shown dim after the title. */
  hint?: string;
  /** Multi-select only: ticked when the menu opens. */
  selected?: boolean;
}

/** Moves a highlighted row up or down, wrapping at both ends. */
export function moveIndex(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

/** The choices whose title, id or hint contains every word typed, case-insensitively. */
export function filterChoices<T extends string>(
  choices: readonly ArrowChoice<T>[],
  filter: string,
): ArrowChoice<T>[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...choices];
  return choices.filter((choice) => {
    const text = `${choice.title} ${choice.value} ${choice.hint ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** What a keypress means to a menu. */
export type MenuAction = "up" | "down" | "toggle" | "submit" | "cancel" | "none";

export function menuAction(key: KeyPress): MenuAction {
  if (key.ctrl && key.name === "c") return "cancel";
  if (key.name === "escape") return "cancel";
  if (key.name === "up" || key.name === "k") return "up";
  if (key.name === "down" || key.name === "j") return "down";
  if (key.name === "space" || key.sequence === " ") return "toggle";
  if (key.name === "return" || key.name === "enter") return "submit";
  return "none";
}

/** Lines a menu uses besides its choices: the question, the filter line, the footer, and the prompt line below. */
const MENU_CHROME = 5;

/** Which choices fit: all of them, or a window that keeps the cursor in view. Returns [start, end). */
export function visibleWindow(
  total: number,
  cursor: number,
  terminalRows?: number,
): [number, number] {
  const room = terminalRows === undefined ? total : Math.max(3, terminalRows - MENU_CHROME);
  if (total <= room) return [0, total];
  // Two of the lines are the "more above" and "more below" notes.
  const size = Math.max(1, room - 2);
  const start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), total - size);
  return [start, start + size];
}
