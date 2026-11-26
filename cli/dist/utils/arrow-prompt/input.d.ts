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
export declare function moveIndex(index: number, count: number, delta: 1 | -1): number;
/** The choices whose title, id or hint contains every word typed, case-insensitively. */
export declare function filterChoices<T extends string>(choices: readonly ArrowChoice<T>[], filter: string): ArrowChoice<T>[];
/** What a keypress means to a menu. */
export type MenuAction = "up" | "down" | "toggle" | "submit" | "cancel" | "none";
export declare function menuAction(key: KeyPress): MenuAction;
/** Which choices fit: all of them, or a window that keeps the cursor in view. Returns [start, end). */
export declare function visibleWindow(total: number, cursor: number, terminalRows?: number): [number, number];
