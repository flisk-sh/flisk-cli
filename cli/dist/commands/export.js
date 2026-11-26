// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * `flisk export render|wrangler|compose`: runs the pinned @flisk-sh/flisk-export, which writes render.yaml, wrangler.toml
 * or a standalone docker-compose.yml from service.json and stops there. It never deploys, never creates DNS records and never calls a cloud API (the
 * export scope agreed in AGENTS.md, "Local-only by default").
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Command } from "commander";
import { findPackageRunner, packageRunnerError, packageRunnerInvocation, safePackageSpec, } from "../utils/npx-invocation.js";
/**
 * The generators live in their own repo (flisk-sh/flisk-export) so they can ship without a CLI release, and are run
 * from npm at a pinned version so a push to its main branch cannot change what `flisk export` does. Move the pin
 * when a new version is published. `FLISK_EXPORT_PACKAGE` overrides the package spec.
 */
export const EXPORT_PACKAGE = "@flisk-sh/flisk-export@0.10.0";
export function exportInvocation(args, env = process.env, platform = process.platform, runtime = {}) {
    const pkg = safePackageSpec(env.FLISK_EXPORT_PACKAGE, EXPORT_PACKAGE);
    const invocation = packageRunnerInvocation([pkg, ...args], {
        ...runtime,
        platform,
        pathEnv: runtime.pathEnv ?? env.PATH ?? env.Path,
    });
    return { ...invocation, pkg };
}
/** The extra line printed when the exporter exits non-zero, in case the runner could not fetch it at all. */
export function unavailableHint(pkg, exitCode, runner = "npx") {
    return `flisk export: ${pkg} exited with code ${exitCode}. If ${runner} could not download it, check your network access (the first run fetches it from npm) or set FLISK_EXPORT_PACKAGE.`;
}
/** Node-level network failures; an "Error:" line with one of these means the download itself failed. */
const NETWORK_ERROR_PATTERN = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|fetch failed|network/i;
/** True when the exporter printed its own "Error: ..." line (an input problem), not a network failure. */
export function reportsInputError(stderr) {
    return stderr
        .split(/\r?\n/)
        .some((line) => line.startsWith("Error:") && !NETWORK_ERROR_PATTERN.test(line));
}
/** Runs flisk-export with the caller's terminal and resolves to its exit code. */
export function runExport(args, spawnFn = spawn, env = process.env) {
    const invocation = exportInvocation(args, env);
    return new Promise((resolve) => {
        let spawnFailed = false;
        let stderr = "";
        const stderrDecoder = new StringDecoder("utf8");
        const child = spawnFn(invocation.command, invocation.args, {
            stdio: ["inherit", "inherit", "pipe"],
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
            // A pipe is not a TTY, so ask colour-aware tools to keep their colour on stderr.
            ...(process.stderr.isTTY ? { env: { ...process.env, FORCE_COLOR: "1" } } : {}),
        });
        // Stderr is piped so we can tell an input error from a failed download, and still shown live. The whole text is
        // kept so a line split across chunks is still seen whole.
        child.stderr?.on("data", (chunk) => {
            stderr += typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
            process.stderr.write(chunk);
        });
        child.on("error", (err) => {
            spawnFailed = true;
            console.error(packageRunnerError("flisk export", err.message));
            resolve(127);
        });
        child.on("close", (code) => {
            if (spawnFailed)
                return;
            stderr += stderrDecoder.end();
            const exitCode = code ?? 1;
            if (exitCode !== 0 && !reportsInputError(stderr)) {
                console.error(unavailableHint(invocation.pkg, exitCode, findPackageRunner(env.PATH ?? env.Path)));
            }
            resolve(exitCode);
        });
    });
}
/** Every argument goes to flisk-export as given; --dry-run is declared here so it shows in help and is put back. */
export function buildForwardedExportArgs(args, options = {}) {
    const forwarded = [...args];
    if (options.dryRun && !forwarded.includes("--dry-run"))
        forwarded.push("--dry-run");
    return forwarded;
}
export const exportCommand = new Command("export")
    .description("Write render.yaml, wrangler.toml or a standalone docker-compose.yml from service.json; never deploys or calls a cloud API (runs flisk-export)")
    .argument("[args...]", "Passed to flisk-export: render [dir] [--resource <name>] [--out <dir>] [--force] | wrangler [dir] --resource <name> [--route <host>] [--out <dir>] [--allow-non-worker] [--force] | compose [dir] [--out <dir>] [--force] [--check]")
    .option("--dry-run", "Print the file and write nothing", false)
    .allowUnknownOption()
    .helpOption(false)
    .action(async (args, options) => {
    process.exitCode = await runExport(buildForwardedExportArgs(args, options));
});
