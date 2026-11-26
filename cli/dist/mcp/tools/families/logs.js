// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { FliskError } from "../../../utils/errors.js";
import { isValidNativeRun } from "../../../utils/native-log.js";
import { LOG_SOURCES } from "../../../utils/tilt-logs.js";
import { argSpec, guard, option } from "../../spec-args.js";
import { flag } from "../shared.js";
/** The `logs` tool's arguments, bound to the `flisk logs` spec. */
export const logsArgs = argSpec(["logs"], [
    "--json",
    option("--unhealthy", {
        description: "Only the logs of failing or still-starting services. The first call after a failed `up`; with every service healthy it returns nothing, not an error.",
    }),
    option("--service", { arg: "services", description: "Only these services" }),
    option("--tail", {
        as: "int",
        min: 1,
        invalid: "tail must be a positive integer",
        suggestions: ["Pass a whole number from 1 to 10000, or omit tail for the last 200 lines"],
        description: null,
        schema: { maximum: 10000 },
    }),
    option("--since", {
        as: "duration",
        suggestions: ["Pass a number with a unit (ms, s, m, h), or omit since for all buffered logs"],
        description: "Only logs newer than this (real event times), for example 30s, 5m, 1h",
    }),
    option("--after", {
        as: "cursor",
        suggestions: ["Pass the data.nextCursor value returned by a previous logs call"],
        description: "Only lines with seq greater than this cursor. Pass the data.nextCursor from a previous logs call; it may be a long integer, so send it as a string.",
    }),
    option("--source", {
        as: "choice",
        choices: LOG_SOURCES,
        invalid: "source must be runtime or build",
        suggestions: [
            "Use runtime for what a service printed (crash causes), build for image build steps, or omit source for both",
        ],
        description: "runtime: only what the services printed (where a crash cause such as an exception or a missing variable is); build: only image build steps. Omit for both.",
    }),
    guard((args) => {
        // Checked before the --grep row stringifies the value and before the --context row
        // validates its own, so these two errors win over a malformed neighbour.
        if (args.grep !== undefined && typeof args.grep !== "string") {
            throw new FliskError("grep must be a string", ["Pass grep as a string, such as error"], 2);
        }
        if (args.context !== undefined && args.grep === undefined) {
            throw new FliskError("context requires grep", ["Pass grep as well, or omit context"], 2);
        }
    }),
    option("--grep", {
        as: "raw",
        description: "Filter content by plain-text match (meta-characters have no special meaning); ignores case unless the text contains uppercase. Matches have match: true.",
    }),
    option("--context", {
        as: "int",
        min: 0,
        invalid: "context must be a non-negative safe integer",
        suggestions: ["Pass a whole number from 0 to 9007199254740991"],
        // Runtime-only bound: the advertised schema stays as it is, but an unsafe integer is
        // refused here instead of reaching `flisk logs`, which would reject it as a usage error.
        coerce: (value, arg) => {
            if (!Number.isSafeInteger(value)) {
                throw new FliskError(`${arg} must be a non-negative safe integer`, [
                    "Pass a whole number from 0 to 9007199254740991",
                ]);
            }
            return value;
        },
        description: "With grep, keep this many neighboring lines per service (match: false). Default 0.",
    }),
    guard((args) => {
        // `flag` owns the boolean check for the MCP-only shape: strings and numbers are refused.
        flag(args.unhealthy, "unhealthy");
    }),
    option("--run", {
        as: "raw",
        coerce: (value, arg) => {
            if (typeof value !== "string" || !isValidNativeRun(value)) {
                throw new FliskError(`${arg} must be current, previous or a run id`, [
                    "For a local-process service use current, previous, or the numeric id printed in its [flisk] run markers",
                ]);
            }
            return value;
        },
        description: "Only one run of each local-process service: current, previous, or a numeric run id. Not available for Docker services.",
    }),
]);
/** `flisk logs --json` with the table's filters, emitted in spec row order. */
export function buildLogsArgs(args) {
    return logsArgs.build(args);
}
