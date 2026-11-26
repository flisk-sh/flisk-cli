import type { RunningService } from "./types.js";
/**
 * The watch-mode dead service: a watcher such as `bun run --watch`, `node --watch`, nodemon or
 * `tsx watch` keeps its own process alive after the app it runs threw at startup, so the process
 * stays up and the readiness probe keeps failing for the whole wait. Its output gives it away
 * instead: the uncaught-error line, then nothing. This module names that line and the pause that
 * proves the service is stuck, not starting (#5038).
 */
/** Silence after a startup-error line that counts as proof the service is stuck, not still starting. */
export declare const STARTUP_ERROR_QUIET_MS = 10000;
/** Why a still-running service that went quiet after a startup error failed its start or restart. */
export declare const STARTUP_ERROR_REASON = "logged a startup error and stopped answering; it may have crashed under a watcher that keeps the process alive";
/** True when a service's own output line is the uncaught-error line a crashed process leaves behind. */
export declare function isStartupErrorLine(line: string): boolean;
/**
 * True when a service wrote a startup-error line and then nothing for `quietMs`: a service still
 * printing is still starting even after an error line (a retried connection, a long stack), while
 * one that stopped after reporting a crash is held up by whatever keeps its process alive.
 */
export declare function isQuietAfterStartupError(service: Pick<RunningService, "lastOutputAt" | "sawStartupError">, quietMs?: number, now?: number): boolean;
