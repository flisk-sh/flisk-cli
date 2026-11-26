// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  type ArrowChoice,
  filterChoices,
  type KeyPress,
  type MenuAction,
  menuAction,
  moveIndex,
  visibleWindow,
} from "../input.js";

// What each keypress means to a menu: arrows and vim keys move, space ticks, Enter submits,
// Ctrl-C and Escape cancel, everything else is ignored.
const ACTION_CASES: { name: string; key: KeyPress; action: MenuAction }[] = [
  { name: "up arrow", key: { name: "up" }, action: "up" },
  { name: "k", key: { name: "k" }, action: "up" },
  { name: "down arrow", key: { name: "down" }, action: "down" },
  { name: "j", key: { name: "j" }, action: "down" },
  { name: "space by name", key: { name: "space" }, action: "toggle" },
  { name: "space by sequence", key: { sequence: " " }, action: "toggle" },
  { name: "return", key: { name: "return" }, action: "submit" },
  { name: "enter", key: { name: "enter" }, action: "submit" },
  { name: "escape", key: { name: "escape" }, action: "cancel" },
  { name: "ctrl-c", key: { name: "c", ctrl: true }, action: "cancel" },
  { name: "a plain letter", key: { name: "x" }, action: "none" },
  { name: "c without ctrl is a letter", key: { name: "c" }, action: "none" },
];

// The movement table: where the highlight lands after each step, wrapping at both ends.
const MOVE_CASES: { index: number; count: number; delta: 1 | -1; next: number }[] = [
  { index: 0, count: 3, delta: -1, next: 2 },
  { index: 2, count: 3, delta: 1, next: 0 },
  { index: 1, count: 3, delta: 1, next: 2 },
  { index: 1, count: 3, delta: -1, next: 0 },
  { index: 0, count: 0, delta: 1, next: 0 },
  { index: 0, count: 1, delta: 1, next: 0 },
];

// A key sequence replayed through menuAction + moveIndex produces the cursor trail a person sees.
const SEQUENCE_CASES: {
  name: string;
  count: number;
  keys: KeyPress[];
  trail: number[];
}[] = [
  {
    name: "down walks to the last choice",
    count: 3,
    keys: [{ name: "down" }, { name: "down" }],
    trail: [1, 2],
  },
  {
    name: "up from the first wraps to the last",
    count: 3,
    keys: [{ name: "up" }],
    trail: [2],
  },
  {
    name: "non-movement keys leave the cursor alone",
    count: 3,
    keys: [{ name: "space" }, { name: "return" }, { name: "x" }, { name: "down" }],
    trail: [0, 0, 0, 1],
  },
  {
    name: "cancel keys are seen but never move",
    count: 3,
    keys: [{ name: "escape" }, { name: "c", ctrl: true }, { name: "j" }],
    trail: [0, 0, 1],
  },
  {
    name: "an empty menu keeps the cursor at zero",
    count: 0,
    keys: [{ name: "down" }, { name: "up" }],
    trail: [0, 0],
  },
];

// The window table: which slice of a long menu is on screen, given the cursor and terminal height.
const WINDOW_CASES: {
  name: string;
  total: number;
  cursor: number;
  terminalRows?: number;
  window: [number, number];
}[] = [
  { name: "no terminal height shows everything", total: 5, cursor: 0, window: [0, 5] },
  { name: "a menu that fits is whole", total: 5, cursor: 4, terminalRows: 40, window: [0, 5] },
  { name: "the window starts at the top", total: 20, cursor: 0, terminalRows: 10, window: [0, 3] },
  {
    name: "the window centres the cursor",
    total: 20,
    cursor: 10,
    terminalRows: 10,
    window: [9, 12],
  },
  {
    name: "the window ends at the bottom",
    total: 20,
    cursor: 19,
    terminalRows: 10,
    window: [17, 20],
  },
  {
    name: "a tiny terminal still shows one choice",
    total: 20,
    cursor: 5,
    terminalRows: 6,
    window: [5, 6],
  },
];

describe("menuAction", () => {
  it.each(ACTION_CASES)("$name means $action", ({ key, action }) => {
    expect(menuAction(key)).toBe(action);
  });
});

describe("moveIndex", () => {
  it.each(MOVE_CASES)(
    "from $index of $count moving $delta lands on $next",
    ({ index, count, delta, next }) => {
      expect(moveIndex(index, count, delta)).toBe(next);
    },
  );
});

describe("a key sequence", () => {
  it.each(SEQUENCE_CASES)("$name", ({ count, keys, trail }) => {
    let cursor = 0;
    const seen = keys.map((key) => {
      const action = menuAction(key);
      if (action === "up" || action === "down") {
        cursor = moveIndex(cursor, count, action === "up" ? -1 : 1);
      }
      return cursor;
    });
    expect(seen).toEqual(trail);
  });
});

describe("visibleWindow", () => {
  it.each(WINDOW_CASES)("$name", ({ total, cursor, terminalRows, window }) => {
    expect(visibleWindow(total, cursor, terminalRows)).toEqual(window);
  });

  it("keeps the cursor inside the window for every position", () => {
    for (let cursor = 0; cursor < 20; cursor += 1) {
      const [from, to] = visibleWindow(20, cursor, 10);
      expect(from).toBeLessThanOrEqual(cursor);
      expect(to).toBeGreaterThan(cursor);
      expect(to - from).toBe(3);
    }
  });
});

describe("filterChoices", () => {
  const CHOICES: readonly ArrowChoice<string>[] = [
    { title: "React", value: "react", hint: "Vite" },
    { title: "Vue 3", value: "vue", hint: "Vite" },
    { title: "Svelte", value: "svelte", hint: "Vite" },
    { title: "Next.js", value: "next", hint: "runs its own dev server" },
  ];

  // The filter table: what is typed on the left, the matching values on the right.
  const FILTER_CASES: { typed: string; values: string[] }[] = [
    { typed: "", values: ["react", "vue", "svelte", "next"] },
    { typed: "   ", values: ["react", "vue", "svelte", "next"] },
    { typed: "VU", values: ["vue"] },
    { typed: "vite", values: ["react", "vue", "svelte"] },
    { typed: "own server", values: ["next"] },
    { typed: "zzz", values: [] },
  ];

  it.each(FILTER_CASES)("typing '$typed' leaves $values", ({ typed, values }) => {
    expect(filterChoices(CHOICES, typed).map((choice) => choice.value)).toEqual(values);
  });

  it("an empty filter returns a copy, so the caller can reorder it harmlessly", () => {
    const kept = filterChoices(CHOICES, "");
    kept.pop();
    expect(CHOICES).toHaveLength(4);
  });
});
