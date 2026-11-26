// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { stripTerminalControls } from "./tilt-events.js";
/** The most of a failure message `flisk up` prints for one resource. */
export const MAX_FAILURE_MESSAGE = 300;
const LOG_TAIL_LINES = 3;
/** Docker/Tilt image-build logs mark the reason with either spelling; keep that line plus four lines of context. */
const BUILD_ERROR_LINE = /(?:^|\s)(?:ERROR|error):\s+(\S.*)$/;
const BUILD_TAIL_LINES = 5;
/** The last lines of a log that have text, joined on one line, keeping the end when it is too long. */
export function logTail(log, lines = LOG_TAIL_LINES) {
    const tail = stripTerminalControls(log)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-lines)
        .join(" ");
    if (!tail)
        return null;
    return capEnd(tail);
}
/**
 * The last `ERROR:`/`error:` line of an image build and the four lines before it. Docker's reason is on that line, but
 * the lines above it (the step and command that failed) are what make it readable, so keep them instead of only the
 * one-line summary used for health checks.
 */
export function buildOutputTail(log, lines = BUILD_TAIL_LINES) {
    const cleaned = stripTerminalControls(log)
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
    let lastError = -1;
    for (const [index, line] of cleaned.entries()) {
        if (BUILD_ERROR_LINE.test(line))
            lastError = index;
    }
    if (lastError < 0)
        return null;
    return capEnd(cleaned
        .slice(Math.max(0, lastError - lines + 1), lastError + 1)
        .map((line) => line.trim())
        .join("\n"));
}
/**
 * The last `ERROR: ...` line of a resource log, without that prefix, or null. Tilt may put the resource name and a
 * separator before each line, so the marker can come after other text.
 */
export function loggedErrorLine(log) {
    let reason = null;
    for (const line of log.split("\n")) {
        const match = line.trimEnd().match(/(?:^|\s)ERROR: (\S.*)$/);
        if (match)
            reason = match[1];
    }
    return reason;
}
/** "last line" or "last 3 lines". */
export function lastLines(count) {
    return count === 1 ? "last line" : `last ${count} lines`;
}
export function capStart(text) {
    return text.length > MAX_FAILURE_MESSAGE ? `${text.slice(0, MAX_FAILURE_MESSAGE - 1)}…` : text;
}
/** Keep the end of a log excerpt, where the reason is, when it is too long for one message. */
export function capEnd(text) {
    return text.length > MAX_FAILURE_MESSAGE
        ? `…${text.slice(text.length - (MAX_FAILURE_MESSAGE - 1))}`
        : text;
}
