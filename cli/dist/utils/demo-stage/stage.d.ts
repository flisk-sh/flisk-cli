import { type DemoDone, type DemoState } from "./frame.js";
export type DemoStage = {
    update(patch: Partial<DemoState>): void;
    fail(message: string, fix?: string, logPath?: string): void;
    finish(done: DemoDone): void;
    /** Stops the repaint timer and leaves the last frame on screen. */
    stop(): void;
};
/**
 * Starts the repaint cadence and returns a function that stops it.
 *
 * The default runs {@link setInterval}; a test can inject a manual scheduler to fire paints
 * deterministically without touching the real timer wheel.
 */
export type RepaintScheduler = (tick: () => void) => () => void;
/**
 * Paints the frame in place.
 *
 * Each paint clears and rewrites the same {@link FRAME_ROWS} lines and then walks the cursor
 * back, so the frame never scrolls. A terminal without a TTY gets one plain line per phase
 * change instead, because an animated frame is meaningless in a piped log.
 */
export declare function createDemoStage(initial: DemoState, stream?: NodeJS.WriteStream, now?: () => number, repaint?: RepaintScheduler): DemoStage;
