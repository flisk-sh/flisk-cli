/**
 * How many terminal columns one grapheme takes (what a person sees as one character, however many code points it has):
 * 0 for a lone joiner or combining mark, 2 for wide text and emoji, 1 for everything else.
 *
 * A joined emoji (family, profession, flag) or one with a skin tone is a single grapheme and two columns. Text-style
 * symbols such as © and ™ are one column unless a variation selector asks for the emoji form.
 */
export declare function cellWidth(grapheme: string): number;
/** The visible width of a line in terminal columns: colour codes take none, wide characters and emoji two. */
export declare function visibleWidth(line: string): number;
/**
 * How many terminal lines a frame takes. A row wider than the terminal wraps onto more lines, and the cursor can only
 * move back over the lines it really printed, so a miscount leaves an old copy of the menu on screen.
 */
export declare function framedLines(rows: readonly string[], columns: number): number;
/** Cuts a row to the terminal width, so a long description never wraps and the menu stays one line per choice. */
export declare function fitRow(row: string, columns: number): string;
