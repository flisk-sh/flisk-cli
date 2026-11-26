// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/** Moves a highlighted row up or down, wrapping at both ends. */
export function moveIndex(index, count, delta) {
    if (count <= 0)
        return 0;
    return (index + delta + count) % count;
}
/** The choices whose title, id or hint contains every word typed, case-insensitively. */
export function filterChoices(choices, filter) {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return [...choices];
    return choices.filter((choice) => {
        const text = `${choice.title} ${choice.value} ${choice.hint ?? ""}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
}
export function menuAction(key) {
    if (key.ctrl && key.name === "c")
        return "cancel";
    if (key.name === "escape")
        return "cancel";
    if (key.name === "up" || key.name === "k")
        return "up";
    if (key.name === "down" || key.name === "j")
        return "down";
    if (key.name === "space" || key.sequence === " ")
        return "toggle";
    if (key.name === "return" || key.name === "enter")
        return "submit";
    return "none";
}
/** Lines a menu uses besides its choices: the question, the filter line, the footer, and the prompt line below. */
const MENU_CHROME = 5;
/** Which choices fit: all of them, or a window that keeps the cursor in view. Returns [start, end). */
export function visibleWindow(total, cursor, terminalRows) {
    const room = terminalRows === undefined ? total : Math.max(3, terminalRows - MENU_CHROME);
    if (total <= room)
        return [0, total];
    // Two of the lines are the "more above" and "more below" notes.
    const size = Math.max(1, room - 2);
    const start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), total - size);
    return [start, start + size];
}
