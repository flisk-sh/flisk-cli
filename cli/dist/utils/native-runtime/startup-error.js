/**
 * The watch-mode dead service: a watcher such as `bun run --watch`, `node --watch`, nodemon or
 * `tsx watch` keeps its own process alive after the app it runs threw at startup, so the process
 * stays up and the readiness probe keeps failing for the whole wait. Its output gives it away
 * instead: the uncaught-error line, then nothing. This module names that line and the pause that
 * proves the service is stuck, not starting (#5038).
 */
/** Silence after a startup-error line that counts as proof the service is stuck, not still starting. */
export const STARTUP_ERROR_QUIET_MS = 10_000;
/** Why a still-running service that went quiet after a startup error failed its start or restart. */
export const STARTUP_ERROR_REASON = "logged a startup error and stopped answering; it may have crashed under a watcher that keeps the process alive";
/**
 * A line that ends a crashed service's startup output: what a watch-mode wrapper prints for an
 * uncaught throw, or the crash report a runtime writes at column zero before its watcher takes over.
 * Each pattern is one short left-anchored match so a long, hostile line cannot stall it.
 */
const STARTUP_ERROR_PATTERNS = [
    // bun, esbuild and tsx: "error: boom at start"
    /^error:/i,
    // "Uncaught Error: ..." (node), "Uncaught Exception: ..." (php)
    /^uncaught\b/i,
    // "Error: x", "TypeError: x", "NullPointerException", "Exception in thread ..." (java)
    /^[\w.$]*(?:Error|Exception)\b/,
    // python: "Traceback (most recent call last):"
    /^traceback \(most recent call last\)/i,
    // go: "panic: runtime error: ..."
    /^panic:/i,
    // "FATAL: ..." (postgres), "Fatal error" (php), "FATAL ERROR: ..." (node v8)
    /^fatal\b/i,
    // nodemon: "[nodemon] app crashed - waiting for file changes before starting..."
    /\bapp crashed\b/i,
    // rust: "thread 'main' panicked at ..."
    /^thread '[^']*' panicked\b/,
];
/** True when a service's own output line is the uncaught-error line a crashed process leaves behind. */
export function isStartupErrorLine(line) {
    return STARTUP_ERROR_PATTERNS.some((pattern) => pattern.test(line));
}
/**
 * True when a service wrote a startup-error line and then nothing for `quietMs`: a service still
 * printing is still starting even after an error line (a retried connection, a long stack), while
 * one that stopped after reporting a crash is held up by whatever keeps its process alive.
 */
export function isQuietAfterStartupError(service, quietMs = STARTUP_ERROR_QUIET_MS, now = Date.now()) {
    return (service.sawStartupError === true &&
        service.lastOutputAt !== undefined &&
        now - service.lastOutputAt >= quietMs);
}
