// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { cellWidth, fitRow, framedLines, visibleWidth } from "../layout.js";

// The width table: one row per case, asserting the exact column count the engine measures.
// Columns are what a terminal cursor advances, so a wide letter counts 2 and a colour code 0.
const WIDTH_CASES: { name: string; text: string; width: number }[] = [
  { name: "ASCII letters", text: "abc", width: 3 },
  { name: "empty row", text: "", width: 0 },
  { name: "CJK ideographs", text: "寿司", width: 4 },
  { name: "Hangul syllable", text: "한", width: 2 },
  { name: "kana", text: "カナ", width: 4 },
  { name: "fullwidth forms", text: "ＡＢＣ", width: 6 },
  { name: "single emoji", text: "🍣", width: 2 },
  { name: "text-style symbols stay one column", text: "©™", width: 2 },
  { name: "combining accent adds no column", text: "e\u0301", width: 1 },
  { name: "family emoji is one grapheme", text: "👨‍👩‍👧‍👦", width: 2 },
  { name: "skin-tone profession emoji", text: "👩🏽‍💻", width: 2 },
  { name: "flag emoji", text: "🇺🇦", width: 2 },
  { name: "rainbow flag with joiners", text: "🏳️‍🌈", width: 2 },
  { name: "ANSI colour codes count nothing", text: "\x1b[36m寿司\x1b[39m ok", width: 7 },
  {
    name: "nested colour codes count nothing",
    text: "\x1b[1m\x1b[36mab\x1b[39m\x1b[22m",
    width: 2,
  },
  { name: "mixed plain and wide text", text: "ab寿司cd", width: 8 },
];

// The fit table: every cut keeps whole graphemes, appends the ellipsis and never exceeds the terminal.
const FIT_CASES: { name: string; row: string; columns: number; expected: string }[] = [
  { name: "a short row is untouched", row: "short", columns: 80, expected: "short" },
  {
    name: "exactly at the edge is untouched",
    row: "x".repeat(79),
    columns: 80,
    expected: "x".repeat(79),
  },
  {
    name: "ASCII over the edge ends in the ellipsis",
    row: "y".repeat(100),
    columns: 20,
    expected: `${"y".repeat(18)}…`,
  },
  {
    name: "a wide character that would pass the edge is dropped",
    row: `ab${"寿".repeat(10)}`,
    columns: 12,
    expected: `ab${"寿".repeat(4)}…`,
  },
  {
    name: "a joined emoji is never split",
    row: `${"ab".repeat(4)}👨‍👩‍👧‍👦👨‍👩‍👧‍👦`,
    columns: 12,
    expected: `${"ab".repeat(4)}👨‍👩‍👧‍👦…`,
  },
  {
    name: "a cut row drops the colour codes, because kept text is built from plain graphemes",
    row: `\x1b[36m${"z".repeat(50)}\x1b[39m`,
    columns: 20,
    expected: `${"z".repeat(18)}…`,
  },
  {
    name: "a narrow floor keeps ten columns even at width 1",
    row: "abcdefghijklmnop",
    columns: 1,
    expected: "abcdefghi…",
  },
];

const FRAME_CASES: { name: string; rows: string[]; columns: number; lines: number }[] = [
  { name: "short rows take one line each", rows: ["short", "also short"], columns: 80, lines: 2 },
  {
    name: "a row at the width takes one line",
    rows: ["012345678 0123456789"],
    columns: 20,
    lines: 1,
  },
  { name: "words wrap onto extra lines", rows: ["one two"], columns: 3, lines: 3 },
  { name: "an empty row still takes a line", rows: [""], columns: 80, lines: 1 },
  {
    name: "ten wide characters are twenty columns",
    rows: ["寿".repeat(10)],
    columns: 10,
    lines: 2,
  },
  { name: "a zero-width terminal still counts one line", rows: ["abc"], columns: 0, lines: 3 },
];

describe("cellWidth", () => {
  it("counts terminal columns per grapheme: wide text and emoji 2, joiners and marks 0, the rest 1", () => {
    expect(cellWidth("a")).toBe(1);
    expect(cellWidth("寿")).toBe(2);
    expect(cellWidth("한")).toBe(2);
    expect(cellWidth("🍣")).toBe(2);
    expect(cellWidth("\u200D")).toBe(0);
    expect(cellWidth("\u0301")).toBe(0);
    expect(cellWidth("©")).toBe(1);
    expect(cellWidth("™")).toBe(1);
  });
});

describe("visibleWidth", () => {
  it.each(WIDTH_CASES)("$name is $width columns", ({ text, width }) => {
    expect(visibleWidth(text)).toBe(width);
  });
});

describe("fitRow", () => {
  it.each(FIT_CASES)("$name", ({ row, columns, expected }) => {
    const cut = fitRow(row, columns);
    expect(cut).toBe(expected);
    expect(visibleWidth(cut)).toBeLessThanOrEqual(Math.max(10, columns - 1));
  });

  it("a row that fits is returned untouched, so the active highlight stays coloured", () => {
    const highlighted = "\x1b[36mshort\x1b[39m";
    expect(fitRow(highlighted, 80)).toBe(highlighted);
  });

  it("a cut row never wraps past the edge, colour codes and all", () => {
    const cut = fitRow(`§${"y".repeat(100)}§`, 20);
    expect(cut).toHaveLength(19); // columns-1 plus the ellipsis
    expect(cut.startsWith("§yyyy")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    expect(framedLines([cut], 20)).toBe(1);
    expect(visibleWidth(fitRow("寿".repeat(30), 20))).toBeLessThanOrEqual(19);
  });
});

describe("framedLines", () => {
  it.each(FRAME_CASES)("$name", ({ rows, columns, lines }) => {
    expect(framedLines(rows, columns)).toBe(lines);
  });
});
