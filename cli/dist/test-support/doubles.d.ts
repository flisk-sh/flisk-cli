import { type MockInstance } from "vitest";
import type { DiscoveredResource } from "../types/index.js";
/**
 * Builds an in-memory `DiscoveredResource` for pure tests. Nothing is written to disk; the paths are fake.
 * Use `createTempProject` when a test needs real files.
 */
export declare function makeResource(name: string, appType: string, config?: Record<string, unknown>): DiscoveredResource;
export interface ExitCapture {
    /** The spy on `process.exit`. It throws `ProcessExitError`, so the code under test stops where the exit happens. */
    exit: MockInstance;
    /** Asserts that the exit was called with `code` exactly once. */
    expectExit(code: number): void;
}
/**
 * Replaces `process.exit` with a spy that throws. The caller catches the throw, for example with
 * `rejects.toThrow("process.exit")`. Restore it with `vi.restoreAllMocks()` in `afterEach`.
 */
export declare function captureExit(): ExitCapture;
export interface StdoutCapture {
    /** Every chunk written to fd 1 (stdout), in order. */
    readonly chunks: string[];
    /** All chunks joined: what the terminal would have received. */
    text(): string;
    /** The first newline-terminated document, for a command that writes one JSON envelope. */
    firstJsonLine(): string;
}
/**
 * Intercepts `writeSync` so writes to fd 1 (stdout) collect in `chunks` instead of reaching the
 * terminal. The test file must mock `node:fs` `writeSync` as a `vi.fn` first; writes to other
 * descriptors pass through.
 */
export declare function captureStdoutWrites(): StdoutCapture;
export interface ExitListeners {
    /** The "exit" listeners added since this call; fire one to simulate the process exiting. */
    added(): Array<(code: number) => void>;
    /** Removes every still-registered added listener. */
    release(): void;
}
/**
 * Tracks the "exit" listeners a run registers, so a test can fire them itself and detach the ones
 * still attached afterwards.
 */
export declare function trackExitListeners(): ExitListeners;
