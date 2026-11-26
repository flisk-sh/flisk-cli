/**
 * Arrow-key prompts: move with the arrows, choose with Enter, never type a number.
 *
 * `flisk create` uses these so the first run is a few key presses (the way `create-t3-app` works)
 * instead of typed answers. The keys and the frame are plain functions, so tests drive them without a
 * terminal; `arrowSelect`, `arrowMultiSelect` and `arrowText` only wire those to a TTY stream.
 *
 * The pieces live under `arrow-prompt/`: `input.js` is the pure input model (keys, cursor, filter,
 * window), `layout.js` is the pure width engine (columns, truncation, wrapping), and `render.js`
 * draws frames and runs the prompt loop. This file re-exports them so every caller keeps importing
 * `utils/arrow-prompt.js` unchanged.
 */
export type { ArrowChoice, KeyPress, MenuAction } from "./arrow-prompt/input.js";
export { filterChoices, menuAction, moveIndex, visibleWindow } from "./arrow-prompt/input.js";
export { cellWidth, fitRow, framedLines, visibleWidth } from "./arrow-prompt/layout.js";
export type { PromptStreams } from "./arrow-prompt/render.js";
export { arrowMultiSelect, arrowSelect, arrowText, PromptCancelled, renderAnswered, renderMenu, } from "./arrow-prompt/render.js";
