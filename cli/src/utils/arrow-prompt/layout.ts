// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The layout engine behind the arrow-key prompts: measuring terminal columns, cutting a row to the
 * screen width and counting how many lines a frame takes. Pure text computation with no TTY or menu
 * state, so every edge case (East-Asian width, emoji sequences, ANSI colour codes) is table-tested.
 */

/** East Asian wide and fullwidth blocks (CJK, Hangul, kana, fullwidth forms): two terminal columns each. */
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;

/**
 * How many terminal columns one grapheme takes (what a person sees as one character, however many code points it has):
 * 0 for a lone joiner or combining mark, 2 for wide text and emoji, 1 for everything else.
 *
 * A joined emoji (family, profession, flag) or one with a skin tone is a single grapheme and two columns. Text-style
 * symbols such as © and ™ are one column unless a variation selector asks for the emoji form.
 */
export function cellWidth(grapheme: string): number {
  if (/^(?:\p{Mn}|\p{Me}|\p{Cf}|[\u{FE00}-\u{FE0F}])+$/u.test(grapheme)) return 0;
  if (WIDE.test(grapheme)) return 2;
  if (/\p{Emoji_Presentation}|\u{FE0F}|\p{Regional_Indicator}/u.test(grapheme)) return 2;
  return 1;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The graphemes of a line, colour codes removed. */
function graphemes(line: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are control codes
  const plain = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  return [...segmenter.segment(plain)].map((part) => part.segment);
}

/** The visible width of a line in terminal columns: colour codes take none, wide characters and emoji two. */
export function visibleWidth(line: string): number {
  let width = 0;
  for (const grapheme of graphemes(line)) width += cellWidth(grapheme);
  return width;
}

/**
 * How many terminal lines a frame takes. A row wider than the terminal wraps onto more lines, and the cursor can only
 * move back over the lines it really printed, so a miscount leaves an old copy of the menu on screen.
 */
export function framedLines(rows: readonly string[], columns: number): number {
  const width = Math.max(1, columns);
  return rows.reduce((total, row) => total + Math.max(1, Math.ceil(visibleWidth(row) / width)), 0);
}

/** Cuts a row to the terminal width, so a long description never wraps and the menu stays one line per choice. */
export function fitRow(row: string, columns: number): string {
  const max = Math.max(10, columns - 1);
  if (visibleWidth(row) <= max) return row;
  // Cut by columns and whole graphemes, so a wide character never pushes the row past the edge and an emoji is
  // never split in the middle of its sequence.
  let kept = "";
  let width = 0;
  for (const grapheme of graphemes(row)) {
    const next = cellWidth(grapheme);
    if (width + next > max - 1) break;
    kept += grapheme;
    width += next;
  }
  return `${kept}…`;
}
