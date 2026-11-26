// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  isQuietAfterStartupError,
  isStartupErrorLine,
  STARTUP_ERROR_QUIET_MS,
  STARTUP_ERROR_REASON,
} from "../startup-error.js";

describe("startup-error cluster interface", () => {
  it("exports the watch-mode dead-service surface", () => {
    expect(typeof isStartupErrorLine).toBe("function");
    expect(typeof isQuietAfterStartupError).toBe("function");
    expect(typeof STARTUP_ERROR_QUIET_MS).toBe("number");
    expect(typeof STARTUP_ERROR_REASON).toBe("string");
  });
});

describe("isStartupErrorLine", () => {
  it.each([
    // bun / esbuild / tsx print an uncaught throw this way and keep watching
    "error: boom at start",
    "error: Uncaught Error: boom",
    // node prints the thrown value, python its last traceback line, java its exception
    "Error: boom at start",
    "TypeError: cannot read properties of undefined",
    "Uncaught Error: boom",
    "Uncaught Exception: boom",
    "ReferenceError: x is not defined",
    "Traceback (most recent call last):",
    "ValueError: missing key",
    'Exception in thread "main" java.lang.RuntimeException: boom',
    // go and rust panics, postgres and php fatals, nodemon's own crash note
    "panic: runtime error: index out of range",
    "FATAL: database files are incompatible with server",
    "Fatal error: Uncaught Error: boom",
    "[nodemon] app crashed - waiting for file changes before starting...",
    "thread 'main' panicked at src/main.rs:2:5:",
  ])("marks the crash line %j", (line) => {
    expect(isStartupErrorLine(line)).toBe(true);
  });

  it.each([
    "warn: deprecated flag",
    "info: starting api",
    "Errors: 0",
    "ExceptionHandler ready",
    "some prefix error: mid-line text",
    "listening on :3000",
    // a stack frame alone is the trace under an error line, not the error itself
    "    at /repo/api/src/index.ts:1:11",
    '  File "/repo/api/main.py", line 1, in <module>',
    "",
  ])("does not mark the ordinary line %j", (line) => {
    expect(isStartupErrorLine(line)).toBe(false);
  });
});

describe("isQuietAfterStartupError", () => {
  const quiet = STARTUP_ERROR_QUIET_MS;

  it("is true once a service that logged an error stayed silent for the window", () => {
    const now = 1_000_000;
    expect(
      isQuietAfterStartupError({ sawStartupError: true, lastOutputAt: now - quiet }, quiet, now),
    ).toBe(true);
  });

  it("is false while output still flows, without an error line, or before any output", () => {
    const now = 1_000_000;
    // Still printing after the error: the service is starting, not stuck.
    expect(
      isQuietAfterStartupError(
        { sawStartupError: true, lastOutputAt: now - quiet + 1 },
        quiet,
        now,
      ),
    ).toBe(false);
    // No error line was ever seen: only the readiness timeout decides.
    expect(isQuietAfterStartupError({ sawStartupError: false, lastOutputAt: 0 }, quiet, now)).toBe(
      false,
    );
    // A service that never wrote anything has no error to be quiet after.
    expect(isQuietAfterStartupError({}, quiet, now)).toBe(false);
  });
});
