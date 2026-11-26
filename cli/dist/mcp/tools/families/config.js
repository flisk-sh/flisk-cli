// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { argSpec, option, positional } from "../../spec-args.js";
import { paths } from "../shared.js";
/**
 * The config family: the generated-master-file commands (`config_verify`, `config_explain`, `config_regenerate`).
 * Each tool's arguments are declared once in an argSpec table bound to the command's generated spec.
 */
/** The `config_verify` tool's arguments, bound to the `flisk config verify` spec. */
export const configVerifyArgs = argSpec(["config", "verify"], [
    "--json",
    option("--diff", {
        arg: "diffFiles",
        // The spec option takes one value per use; the tool argument is a list, one --diff=<file> per element.
        as: "raw",
        coerce: (value, arg) => paths(value, arg),
        schema: {
            type: "array",
            items: {
                type: "string",
                description: "A path reported in data.diffs, e.g. .flisk/.flisk-out/Tiltfile",
            },
        },
        description: "Include a capped diff for each named drifted file instead of a summary only",
    }),
]);
/** `flisk config verify --json`, with a `--diff=<file>` for each drifted file the caller asks to see. */
export function buildConfigVerifyArgs(args = {}) {
    return configVerifyArgs.build(args);
}
/** Short human text for config_verify: structuredContent already carries the full report (#4205). */
const VERIFY_SUMMARY_LINE_LIMIT = 60;
export function summarizeConfigVerify(data) {
    const envelope = data;
    const report = envelope?.data;
    if (!report || typeof report !== "object")
        return undefined;
    const errors = Array.isArray(report.errors)
        ? report.errors.filter((error) => typeof error === "string")
        : [];
    const diffs = Array.isArray(report.diffs) ? report.diffs : [];
    const missing = diffs.filter((entry) => entry?.state === "missing").length;
    const different = diffs.filter((entry) => entry?.state === "different").length;
    const heading = errors.length === 0 && report.valid === true
        ? "config verify: all files are in sync."
        : `config verify: ${errors.length} finding(s); ${missing} missing, ${different} different file(s).`;
    const lines = [heading, ...errors];
    if (diffs.length > 0) {
        lines.push("See structuredContent for every path; pass diffFiles to request a file's diff.");
    }
    if (lines.length > VERIFY_SUMMARY_LINE_LIMIT) {
        const hidden = lines.length - VERIFY_SUMMARY_LINE_LIMIT;
        lines.length = VERIFY_SUMMARY_LINE_LIMIT;
        lines.push(`... [${hidden} more line(s) in structuredContent]`);
    }
    return lines.join("\n");
}
/** The `config_explain` tool's arguments, bound to the `flisk config explain` spec. */
export const configExplainArgs = argSpec(["config", "explain"], [
    positional("file", {
        as: "path",
        required: true,
        suggestions: ["Pass the project file to explain, for example .flisk/.flisk-out/Tiltfile"],
        description: "The file, relative to projectPath (or to the server's directory) or absolute; it must be inside the project",
    }),
    "--json",
]);
/** `flisk config explain <file> --json`; `file` is the one required argument. */
export function buildConfigExplainArgs(args) {
    return configExplainArgs.build(args);
}
/** The `config_regenerate` tool's arguments, bound to the `flisk config regenerate` spec. */
export const configRegenerateArgs = argSpec(["config", "regenerate"], [
    // A dry run by default: a real run rewrites the generated master files from
    // .flisk/project.json and discards any hand edits in them.
    option("--dry-run", {
        arg: "dryRun",
        default: true,
        description: "Default true: show what would change. false rewrites the files and discards hand edits in them",
    }),
    "--json",
]);
/**
 * `flisk config regenerate`, a dry run unless `dryRun` is explicitly false: a real run rewrites the generated master files
 * from .flisk/project.json and discards any hand edits in them.
 */
export function buildConfigRegenerateArgs(args) {
    return configRegenerateArgs.build(args);
}
