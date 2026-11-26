// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { DEMO_DISCORD_URL, DEMO_STAR_URL, FRAME_ROWS, frameToPlain, renderDemoFrame, styleRow, } from "./frame.js";
const REPAINT_INTERVAL_MS = 200;
const intervalRepaint = (tick) => {
    const timer = setInterval(tick, REPAINT_INTERVAL_MS);
    // The frame must never be the reason a finished demo keeps the process alive.
    timer.unref?.();
    return () => clearInterval(timer);
};
/**
 * Paints the frame in place.
 *
 * Each paint clears and rewrites the same {@link FRAME_ROWS} lines and then walks the cursor
 * back, so the frame never scrolls. A terminal without a TTY gets one plain line per phase
 * change instead, because an animated frame is meaningless in a piped log.
 */
export function createDemoStage(initial, stream = process.stderr, now = Date.now, repaint = intervalRepaint) {
    const animate = stream.isTTY === true;
    const startedAt = now();
    let state = { ...initial };
    let painted = false;
    let lastFrame = "";
    let lastPlainSignature = "";
    let cancelRepaint;
    const snapshot = () => {
        const finished = Boolean(state.done || state.failure);
        return {
            ...state,
            elapsedMs: finished ? state.elapsedMs : now() - startedAt,
        };
    };
    const paint = () => {
        const current = snapshot();
        const rows = renderDemoFrame(current, stream.columns ?? 80);
        const plain = frameToPlain(rows);
        if (!animate) {
            const signature = plain.join("\n");
            if (signature === lastPlainSignature)
                return;
            lastPlainSignature = signature;
            stream.write(`${plain.filter((line) => line.trim() !== "").join("\n")}\n`);
            return;
        }
        const frame = plain.join("\n");
        if (frame === lastFrame && painted)
            return;
        lastFrame = frame;
        // Walk back to the first row of the previous paint, then clear and rewrite each line.
        if (painted)
            stream.write(`\x1b[${FRAME_ROWS}A`);
        for (const row of rows)
            stream.write(`\r\x1b[2K${styleRow(row)}\n`);
        painted = true;
    };
    if (animate) {
        paint();
        cancelRepaint = repaint(paint);
    }
    return {
        update(patch) {
            state = { ...state, ...patch, phases: patch.phases ?? state.phases };
            paint();
        },
        fail(message, fix, logPath) {
            state = {
                ...state,
                elapsedMs: now() - startedAt,
                failure: { message, fix, logPath },
                phases: state.phases.map((phase) => phase.status === "active" ? { ...phase, status: "failed" } : phase),
            };
            paint();
        },
        finish(done) {
            // A piped log or a CI run is not a person who could star the repo or join Discord.
            const isPerson = animate && !process.env.CI;
            const starUrl = isPerson ? DEMO_STAR_URL : undefined;
            const discordUrl = isPerson ? DEMO_DISCORD_URL : undefined;
            state = { ...state, elapsedMs: now() - startedAt, done: { ...done, starUrl, discordUrl } };
            paint();
        },
        stop() {
            cancelRepaint?.();
            cancelRepaint = undefined;
        },
    };
}
