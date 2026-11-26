// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { FliskError } from "../../../utils/errors.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS, parseTimeoutSeconds } from "../../../utils/up-wait.js";
import type { McpToolResult } from "../../server.js";
import { argSpec, option, positional } from "../../spec-args.js";
import { type RunFlisk, viaCli } from "../run.js";

/** The `wait` tool's arguments, bound to the `flisk wait` spec. */
export const waitArgs = argSpec(
  ["wait"],
  [
    positional("services", {
      as: "names",
      description: "Only wait for these services; omit to wait for every service",
    }),
    option("--timeout", {
      arg: "timeoutSeconds",
      as: "int",
      min: 1,
      max: 21600,
      default: DEFAULT_WAIT_TIMEOUT_SECONDS,
      invalid: "timeoutSeconds must be a whole number of seconds from 1 to 21600",
      suggestions: [
        "Pass timeoutSeconds as a whole number of seconds from 1 to 21600, for example 60",
      ],
      description: "How long to wait before giving up (default 1800, at most 21600)",
    }),
    "--json",
  ],
);

/** `flisk wait [services...] --timeout=<seconds> --json` for the `wait` tool. */
export function buildWaitArgs(args: Record<string, unknown>): string[] {
  // parseTimeoutSeconds accepts a numeric string such as "60" as well as a number; normalise
  // first so callers that worked before the table still get --timeout=60, then let the table
  // apply its bounds to the whole number.
  const parsed = parseTimeoutSeconds(args.timeoutSeconds, "timeoutSeconds");
  if (!parsed.ok) {
    throw new FliskError(parsed.message, [
      "Pass timeoutSeconds as a whole number of seconds from 1 to 21600, for example 60",
    ]);
  }
  return waitArgs.build({ ...args, timeoutSeconds: parsed.seconds });
}

/** A tool call may wait longer than the usual CLI timeout: give the command its full window plus a little slack. */
export function waitCliTimeoutMs(args: Record<string, unknown>): number {
  const parsed = parseTimeoutSeconds(args.timeoutSeconds, "timeoutSeconds");
  const seconds = parsed.ok ? parsed.seconds : DEFAULT_WAIT_TIMEOUT_SECONDS;
  return seconds * 1000 + 30_000;
}

/** The `wait` row's handler: `flisk wait --json` with a timeout sized to the requested wait window. */
export const waitRun =
  (deps: { run: RunFlisk }) =>
  async (args: Record<string, unknown>): Promise<McpToolResult> =>
    viaCli(buildWaitArgs, { timeoutMs: waitCliTimeoutMs(args) })(deps)(args);
