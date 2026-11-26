// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/** Removes every leading `char` (one character) from `text`, without a backtracking regex. */
export function trimStartChar(text, char) {
    let start = 0;
    while (start < text.length && text[start] === char)
        start++;
    return text.slice(start);
}
/** Removes every trailing `char` (one character) from `text`, without a backtracking regex. */
export function trimEndChar(text, char) {
    let end = text.length;
    while (end > 0 && text[end - 1] === char)
        end--;
    return text.slice(0, end);
}
/** Removes every leading and trailing `char` (one character) from `text`. */
export function trimChar(text, char) {
    return trimEndChar(trimStartChar(text, char), char);
}
/** Removes every leading character that appears in `chars` (a set of characters, not a sequence). */
export function trimStartChars(text, chars) {
    let start = 0;
    while (start < text.length && chars.includes(text.charAt(start)))
        start++;
    return text.slice(start);
}
/** Removes every trailing character that appears in `chars` (a set of characters, not a sequence). */
export function trimEndChars(text, chars) {
    let end = text.length;
    while (end > 0 && chars.includes(text.charAt(end - 1)))
        end--;
    return text.slice(0, end);
}
/** Removes every leading and trailing character that appears in `chars`. */
export function trimChars(text, chars) {
    return trimEndChars(trimStartChars(text, chars), chars);
}
