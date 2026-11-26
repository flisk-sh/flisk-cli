// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { cliInvocation } from "../../utils/cli-invocation.js";
import { DEFAULT_MCP_CLI_TIMEOUT_MS } from "../../utils/container-restart.js";
import { projectPath } from "./shared.js";
/** Runs this same CLI (`flisk <args>`) so every tool behaves exactly like its command. */
export const runFliskCli = (args, options = {}) => new Promise((resolve, reject) => {
    const [command, ...prefix] = cliInvocation();
    const child = spawn(command, [...prefix, ...args], {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? DEFAULT_MCP_CLI_TIMEOUT_MS);
    child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
    });
    child.once("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr });
    });
});
function parseObject(text) {
    try {
        const value = JSON.parse(text);
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value
            : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Turn a command's `--json` stdout into a tool result. A parseable envelope with errors, or `ok: false` (in `data`, or at
 * the top level for `runtime --check-assets --json`, which prints no envelope), is an error result.
 */
export function toToolResult(run) {
    const lines = run.stdout.trim().split("\n");
    // The envelope ends stdout, on one line or pretty-printed from a "{" at column 0 (`projects`, `networks`); anything
    // before it is incidental output. Nested lines of a pretty-printed envelope are indented, so they never start one.
    let envelope;
    for (let i = lines.length - 1; i >= 0 && !envelope; i--) {
        if (lines[i]?.startsWith("{"))
            envelope = parseObject(lines.slice(i).join("\n"));
    }
    // Otherwise the last JSON line, when something was printed after it.
    const lastLine = lines.filter((line) => line.trim().startsWith("{")).pop();
    envelope ??= lastLine === undefined ? undefined : parseObject(lastLine);
    if (!lastLine) {
        return {
            data: {
                errors: [
                    {
                        code: "NO_JSON",
                        message: run.stderr.trim() || `flisk exited with code ${run.exitCode}`,
                    },
                ],
            },
            isError: true,
        };
    }
    if (!envelope) {
        return {
            data: { errors: [{ code: "BAD_JSON", message: lastLine.slice(0, 200) }] },
            isError: true,
        };
    }
    const failed = (envelope.errors?.length ?? 0) > 0 || envelope.data?.ok === false || envelope.ok === false;
    return { data: envelope, isError: failed };
}
/**
 * Turn the output of a command that has no `--json` (the scaffolding commands) into a tool result: its text output, and an
 * error result when it exits non-zero. Failures are printed to stderr, so it is returned too.
 */
export function toTextResult(run) {
    const stderr = run.stderr.trim();
    return {
        data: {
            exitCode: run.exitCode,
            output: run.stdout.trim(),
            ...(stderr ? { stderr } : {}),
        },
        isError: run.exitCode !== 0,
    };
}
/**
 * The generic handler for a table row whose tool maps to one `flisk` command with a `--json` envelope: build the
 * arguments, run the CLI through the injected runner and convert its output. Per family, not per tool.
 */
export const viaCli = (build, options = {}) => ({ run }) => async (args) => toToolResult(await run(build(args), {
    cwd: projectPath(args.projectPath),
    ...options,
}));
/** For a command without `--json`: returns its text output. */
export const viaCliText = (build, options = {}) => ({ run }) => async (args) => toTextResult(await run(build(args), {
    cwd: projectPath(args.projectPath),
    ...options,
}));
