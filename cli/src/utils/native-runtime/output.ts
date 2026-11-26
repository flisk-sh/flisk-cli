// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { ChildProcess } from "node:child_process";
import { LOG_SEQ_SUB_MILLISECOND } from "../log-cursors.js";
import { appendNativeLogLine } from "../native-log.js";
import { createPrivateKeyLineGuard } from "../secret-redaction.js";

/**
 * Where service output goes: each child's stdout and stderr are split into lines, scrubbed of secrets, stamped
 * and appended to the service's log file, and reported to `flisk up` through the event callbacks. The seq
 * counter and per-service log sizes are shared across the run's services so cursors and rotation stay coherent.
 */

/** What `pipeServiceOutput` needs beyond the stream itself. */
export interface ServiceOutputOptions {
  /** The service's log file (from `nativeLogPath`). */
  logPath: string;
  /** The run-wide line counter, shared so lines of different services never share a seq. */
  seq: { value: number };
  /** Known size of each service log, shared by its stdout and stderr writers, for rotation (#3720). */
  logSizes: Map<string, number>;
  redactLine: (line: string) => string;
  onLine?: (service: string, line: string, stream: "stdout" | "stderr") => void;
  onNote?: (service: string, message: string) => void;
  /**
   * False once the service has a newer run: a child's stdio can outlive it (a descendant that inherited the pipe), and
   * its late output must not be logged after the new run's start marker, where it would be attributed to that run (#4693).
   * The terminal still shows the line.
   */
  isCurrentRun?: () => boolean;
}

/** Pipes a service child's stdout and stderr into its log file and the run's event callbacks. */
export function pipeServiceStreams(
  name: string,
  child: ChildProcess,
  options: ServiceOutputOptions,
): void {
  pipeServiceOutput(name, child.stdout, "stdout", options);
  pipeServiceOutput(name, child.stderr, "stderr", options);
}

/** Pipes one service stream into its log file and the run's event callbacks. */
export function pipeServiceOutput(
  name: string,
  stream: NodeJS.ReadableStream | null,
  kind: "stdout" | "stderr",
  options: ServiceOutputOptions,
): void {
  if (!stream) return;
  const logPath = options.logPath;
  let pending = "";
  let redactionWarningShown = false;
  // One guard per stream: a private key printed over many lines is masked from its BEGIN line to its END line.
  const keyGuard = createPrivateKeyLineGuard();
  const emit = (line: string) => {
    let safeLine: string;
    try {
      safeLine = options.redactLine(keyGuard(line));
    } catch {
      // An unreadable env file must not turn a secret-scrubbing failure into a leak.
      if (!redactionWarningShown) {
        options.onNote?.(name, "output withheld: env secrets could not be read for redaction");
        redactionWarningShown = true;
      }
      return;
    }
    if (options.isCurrentRun?.() ?? true) {
      try {
        // A timestamp per line lets `flisk logs` merge services in order and honour --since; the number lets a
        // cursor read ask for only what came later. It has the same time-based scale as numbers derived from
        // Tilt/Docker lines, so the two runtimes can share one cursor. The log is rotated to <service>.log.1 at
        // NATIVE_LOG_MAX_BYTES, so it cannot grow without bound (#3720).
        const now = new Date();
        options.seq.value = Math.max(
          options.seq.value + 1,
          now.getTime() * LOG_SEQ_SUB_MILLISECOND,
        );
        appendNativeLogLine(
          logPath,
          `${now.toISOString()} #${options.seq.value} ${safeLine}\n`,
          options.logSizes,
        );
      } catch {
        // A full disk must not stop the service; the terminal still shows the line.
      }
    }
    options.onLine?.(name, safeLine, kind);
  };
  stream.setEncoding?.("utf-8");
  stream.on("data", (chunk: string) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) emit(line);
  });
  stream.on("end", () => {
    if (pending) emit(pending);
    pending = "";
  });
}
