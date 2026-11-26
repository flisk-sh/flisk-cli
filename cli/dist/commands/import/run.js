// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import fs from "node:fs";
import path, { basename, dirname } from "node:path";
import { installAgentSkills } from "../../utils/agent-skills.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import { JsonCommandError, runJsonCommand } from "../../utils/json-command.js";
import { nativeWindowsImportNotice } from "../../utils/native-windows.js";
import { packageRunnerError } from "../../utils/npx-invocation.js";
import { getPackageVersion } from "../../utils/paths.js";
import { buildForwardedImportArgs, importInvocation, TILTFILE_IMPORTER } from "./invocation.js";
import { parseImportPlan } from "./plan.js";
import { skippedImportSources, skippedSourcesNotice, } from "./skipped-sources.js";
import { formatCoverageBlock, importCoverageSummary } from "./summary.js";
import { checkCoreVersion } from "./version-gate.js";
/**
 * The directory `flisk import` ran on: the first argument that is not a flag, or "." when none
 * is. A `tiltfile` import has no Compose file to read, so it gets no directory.
 */
export function importDirArg(forwardedArgs) {
    if (forwardedArgs[0] === TILTFILE_IMPORTER)
        return null;
    return forwardedArgs.find((arg) => !arg.startsWith("-")) ?? ".";
}
/**
 * The summary of what an import dropped, approximated or skipped by design (#3108), printed as
 * one block when there is anything to say. The importer prints these as plan notes; the summary
 * also reads the Compose file for the `networks` collapse the importer does not name.
 */
function printCoverageBlock(forwardedArgs, importerStdout) {
    const dir = importDirArg(forwardedArgs);
    const block = formatCoverageBlock(importCoverageSummary(importerStdout, dir ? { dir } : {}));
    if (block)
        console.log(`\n${block}`);
}
/**
 * Runs flisk-import with the caller's terminal and resolves to its exit code. stdout is piped and
 * passed through, so the coverage summary can be printed after the importer's own output.
 */
export function runImport(args, spawnFn = spawn, getVersionFn = getPackageVersion) {
    const check = checkCoreVersion(getVersionFn(), args);
    if (!check.ok) {
        console.error(check.message);
        return Promise.resolve(1);
    }
    const invocation = importInvocation(args);
    return new Promise((resolve) => {
        const child = spawnFn(invocation.command, invocation.args, {
            stdio: ["inherit", "pipe", "inherit"],
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        });
        let stdout = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
            process.stdout.write(chunk);
        });
        child.on("error", (err) => {
            console.error(packageRunnerError("flisk import", err.message));
            resolve(127);
        });
        child.on("close", (code) => {
            if (code === 0)
                printCoverageBlock(args, stdout);
            resolve(code ?? 1);
        });
    });
}
/**
 * Runs flisk-import with its output piped instead of the caller's terminal and no stdin, so it can never prompt, and
 * resolves to what it printed and its exit code. A refusal of the core version gate or a missing package runner is a run too.
 */
export function runImportCaptured(args, spawnFn = spawn, getVersionFn = getPackageVersion) {
    const check = checkCoreVersion(getVersionFn(), args);
    if (!check.ok) {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: check.message ?? "" });
    }
    const invocation = importInvocation(args);
    return new Promise((resolve) => {
        const child = spawnFn(invocation.command, invocation.args, {
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (err) => {
            resolve({
                exitCode: 127,
                stdout,
                stderr: packageRunnerError("flisk import", err.message),
            });
        });
        child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
}
/** A sibling Procfile the importer does not read, as an entry of `skipped`. */
function procfileSkip(source) {
    return {
        source: source.file,
        detector: "procfile",
        reason: "not imported; flisk import reads only the root Compose file",
        processes: source.processes,
    };
}
/** The report of a successful run, read from the forwarded arguments and the importer's "  wrote <path>" lines. */
export function importReport(forwardedArgs, run, skipped = []) {
    const isTiltfile = forwardedArgs[0] === TILTFILE_IMPORTER;
    const positional = (isTiltfile ? forwardedArgs.slice(1) : forwardedArgs).find((arg) => !arg.startsWith("-"));
    const plan = parseImportPlan(run.stdout);
    const common = {
        dryRun: forwardedArgs.includes("--dry-run"),
        force: forwardedArgs.includes("--force"),
        written: [...run.stdout.matchAll(/^[ \t]+wrote (\S.*)$/gm)].map((match) => match[1].trim()),
        ...plan,
        output: run.stdout.trim(),
    };
    return isTiltfile
        ? { path: positional ?? "Tiltfile", ...common }
        : {
            dir: positional ?? ".",
            ...common,
            skipped: [...plan.skipped, ...skipped.map(procfileSkip)],
        };
}
/**
 * The error of a failed run: the importer's "Error: ..." line (or whatever it printed last) and its "-> ..." hints. The
 * importer prints "Nothing to import: ..." on stdout, so stdout is read when stderr says nothing.
 */
export function importFailure(run, commandName = "flisk import") {
    const lines = (text) => text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const errLines = lines(run.stderr);
    const hints = errLines
        .filter((line) => line.startsWith("->"))
        .map((line) => line.slice(2).trim());
    const errorLine = errLines.find((line) => line.startsWith("Error:"));
    const message = errorLine?.replace(/^Error:\s*/, "") ??
        (errLines.filter((line) => !line.startsWith("->")).join(" ") ||
            lines(run.stdout).pop() ||
            `flisk-import exited with code ${run.exitCode}`);
    const fallback = run.exitCode === 127
        ? "Install Node.js (npx) or Bun (bunx), then run the command again"
        : `Run \`${commandName} --dry-run\` to see the plan without writing anything`;
    const suggestions = hints.length > 0 ? hints : [fallback];
    return new JsonCommandError("IMPORT_FAILED", message, suggestions, run.exitCode);
}
export function resolveImportOptions(options = {}, cmd) {
    const parentOpts = (cmd?.parent?.opts() ?? {});
    const cmdOpts = (cmd?.opts() ?? {});
    return {
        yes: Boolean(options.yes || cmdOpts.yes || parentOpts.yes),
        force: Boolean(options.force || cmdOpts.force || parentOpts.force),
        dryRun: Boolean(options.dryRun || cmdOpts.dryRun || parentOpts.dryRun),
        json: Boolean(options.json || cmdOpts.json || parentOpts.json),
        agentSkills: options.agentSkills !== false &&
            cmdOpts.agentSkills !== false &&
            parentOpts.agentSkills !== false,
    };
}
/**
 * After a successful Compose import, write the same AGENTS.md and Flisk agent skills `flisk project`
 * writes, so a coding agent opened in the imported project knows to run it with `flisk up` (#3213).
 * Skipped on a dry run, with --no-agent-skills, or when the run left no `.flisk/project.json` (nothing
 * was imported). Never overwrites: when AGENTS.md already exists, one stderr line suggests adding the
 * Flisk section instead. A failure here is a warning, not an exit. Returns the paths written.
 */
export function installImportAgentSkills(dir, options = {}) {
    if (options.agentSkills === false || options.dryRun)
        return [];
    const projectRoot = path.resolve(dir);
    if (!fs.existsSync(path.join(projectRoot, ".flisk", "project.json")))
        return [];
    const hadAgentsMd = fs.existsSync(path.join(projectRoot, "AGENTS.md"));
    try {
        const written = installAgentSkills(projectRoot);
        // Under --json stderr stays empty on success: the files are the only trace.
        if (options.quiet)
            return written;
        if (hadAgentsMd) {
            console.error("flisk import: AGENTS.md already exists and was left unchanged; add the Flisk section " +
                "(to run this project: `flisk up`; when something fails: `flisk doctor --json`)");
        }
        else if (written.length > 0) {
            console.error("flisk import: wrote AGENTS.md and the Flisk agent skills (.agents/skills, .claude/skills)");
        }
        return written;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`flisk import: could not add the agent skills: ${reason}`);
        return [];
    }
}
/**
 * Preserves a Compose `command` on a service that also has `build:` (#3060).
 * In Compose, a service can define both `build:` and `command:`. Flisk maps container
 * runtime arguments to `container.command` so the Compose generator passes it through.
 */
export function carryOverBuildCommand(manifest, command) {
    const rawCommand = command ?? manifest.command;
    if (!rawCommand)
        return manifest;
    const commandList = Array.isArray(rawCommand)
        ? rawCommand.map(String)
        : typeof rawCommand === "string" && rawCommand.trim() !== ""
            ? (rawCommand.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) => (token.startsWith('"') && token.endsWith('"')) ||
                (token.startsWith("'") && token.endsWith("'"))
                ? token.slice(1, -1)
                : token)
            : undefined;
    if (!commandList || commandList.length === 0)
        return manifest;
    const hasBuild = manifest.build !== undefined ||
        manifest.buildContext !== undefined ||
        manifest.dockerfile !== undefined;
    if (hasBuild || manifest.image) {
        const existingContainer = manifest.container &&
            typeof manifest.container === "object" &&
            !Array.isArray(manifest.container)
            ? manifest.container
            : {};
        const updated = {
            ...manifest,
            container: {
                ...existingContainer,
                command: commandList,
            },
        };
        if ("command" in updated) {
            delete updated.command;
        }
        return updated;
    }
    return manifest;
}
/**
 * Normalizes any written service.json files where build and command were declared,
 * ensuring container.command is populated.
 */
export function syncImportedManifestCommands(writtenPaths) {
    for (const relativePath of writtenPaths) {
        try {
            if (!relativePath.endsWith("service.json"))
                continue;
            if (!fs.existsSync(relativePath))
                continue;
            const content = fs.readFileSync(relativePath, "utf-8");
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
                const updated = carryOverBuildCommand(parsed);
                if (JSON.stringify(updated) !== JSON.stringify(parsed)) {
                    fs.writeFileSync(relativePath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
                }
            }
        }
        catch {
            // Best-effort post-processing; ignore unreadable files
        }
    }
}
/**
 * Compose file names a `flisk import <file>` argument is allowed to name; the file stands for its parent directory,
 * the habit `docker compose -f file.yml` trains.
 */
const COMPOSE_FILE_NAMES = new Set([
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
]);
/**
 * Checks the directory argument before the importer runs, which answers every non-directory with the same
 * "is not a directory" line. A missing path is told apart (`<path> does not exist`), a Compose file is honoured as
 * its parent directory, and any other file is refused with the directory to pass instead. The tiltfile positional
 * is a file on purpose and is never checked.
 */
export function checkImportDirArg(args, commandName = "flisk import", statFn = (path) => fs.statSync(path, { throwIfNoEntry: false })) {
    if (args[0] === TILTFILE_IMPORTER)
        return { status: "ok" };
    let composeSeen = false;
    for (const [index, arg] of args.entries()) {
        if (!composeSeen && arg === "compose") {
            composeSeen = true;
            continue;
        }
        if (arg.startsWith("-"))
            continue;
        let stat;
        try {
            stat = statFn(arg);
        }
        catch {
            // An unreadable entry (permissions, a dangling link) is the importer's error to report.
            return { status: "ok" };
        }
        if (!stat) {
            return {
                status: "error",
                message: `${arg} does not exist`,
                suggestion: `Run \`${commandName}\` in the directory that holds docker-compose.yml (or compose.yaml)`,
            };
        }
        if (stat.isDirectory())
            return { status: "ok" };
        const parent = dirname(arg) || ".";
        if (COMPOSE_FILE_NAMES.has(basename(arg))) {
            return { status: "rewrite", index, dir: parent };
        }
        return {
            status: "error",
            message: `${arg} is a file, not a directory`,
            suggestion: `Pass the directory that holds it: ${commandName} ${parent}`,
        };
    }
    return { status: "ok" };
}
/**
 * Runs `flisk import` (and its `compose` / `tiltfile` subcommands). With `--json` the importer runs captured and never
 * prompts; otherwise it inherits the terminal, and a run that would write is refused when there is no terminal to ask in.
 * Sets `process.exitCode` to the importer's exit code, or 1 for a refusal.
 */
export async function executeImport(args, options = {}, commandName = "flisk import") {
    // Suppress the human Windows notice under `--json` so stderr stays empty on success.
    if (!options.json) {
        const windowsNotice = nativeWindowsImportNotice(process.platform, process.env.FLISK_ALLOW_NATIVE_WINDOWS);
        if (windowsNotice)
            console.error(windowsNotice);
    }
    const dirCheck = checkImportDirArg(args, commandName);
    if (dirCheck.status === "rewrite") {
        console.error(`-> ${args[dirCheck.index]} is a Compose file; importing its directory ${dirCheck.dir}`);
    }
    const effectiveArgs = dirCheck.status === "rewrite"
        ? args.map((arg, index) => (index === dirCheck.index ? dirCheck.dir : arg))
        : args;
    if (options.json) {
        await runJsonCommand("IMPORT_FAILED", commandName, async () => {
            if (dirCheck.status === "error") {
                throw new JsonCommandError("IMPORT_FAILED", dirCheck.message, [dirCheck.suggestion], 1);
            }
            // Without a terminal the importer cannot ask, so --json writes without a prompt, like --yes.
            const forwardedArgs = buildForwardedImportArgs(effectiveArgs, { ...options, yes: true });
            const run = await runImportCaptured(forwardedArgs);
            // The importer writes manifests one by one, so even a failed run may have written some.
            clearDiscoveryCache();
            if (run.exitCode !== 0)
                throw importFailure(run, commandName);
            // Keep the human report solely in `data.output` so stderr stays empty on success under `--json`.
            const report = importReport(forwardedArgs, run, skippedImportSources(forwardedArgs));
            if ("dir" in report) {
                const dir = importDirArg(forwardedArgs);
                const coverage = importCoverageSummary(run.stdout, dir ? { dir } : {});
                if (coverage.dropped.length || coverage.approximated.length || coverage.byDesign.length) {
                    report.coverage = coverage;
                }
            }
            syncImportedManifestCommands(report.written);
            if ("dir" in report) {
                installImportAgentSkills(report.dir, {
                    agentSkills: options.agentSkills,
                    dryRun: report.dryRun,
                    quiet: true,
                });
            }
            return { data: report };
        });
        return;
    }
    if (dirCheck.status === "error") {
        console.error(`Error: ${dirCheck.message}\n  -> ${dirCheck.suggestion}`);
        process.exitCode = 1;
        return;
    }
    const forwardedArgs = buildForwardedImportArgs(effectiveArgs, options);
    const refusal = nonInteractiveRefusal(forwardedArgs, commandName);
    if (refusal) {
        console.error(refusal);
        process.exitCode = 1;
        return;
    }
    process.exitCode = await runImport(forwardedArgs);
    // A partial failure may still have written manifests, so clear whatever the exit code.
    clearDiscoveryCache();
    // The importer reads the root Compose file alone; name the Procfiles it left behind (#5033).
    const skipped = skippedImportSources(forwardedArgs);
    if (skipped.length > 0)
        console.error(skippedSourcesNotice(skipped));
    if (process.exitCode === 0 && forwardedArgs[0] !== TILTFILE_IMPORTER) {
        const dir = forwardedArgs.find((arg) => !arg.startsWith("-")) ?? ".";
        installImportAgentSkills(dir, {
            agentSkills: options.agentSkills,
            dryRun: forwardedArgs.includes("--dry-run"),
        });
    }
}
/**
 * Without a terminal the importer cannot ask its (Y/n) question: it wrote nothing and exited 0, which a coding agent or CI
 * job reads as success. A run that would write, with no `--yes` and no stdin TTY, is refused with exit 1 before it starts.
 */
export function nonInteractiveRefusal(forwardedArgs, commandName = "flisk import", isTTY = Boolean(process.stdin.isTTY)) {
    if (isTTY)
        return null;
    const answersItself = ["--yes", "--dry-run", "--help", "-h"].some((flag) => forwardedArgs.includes(flag));
    if (answersItself)
        return null;
    return [
        `${commandName}: no terminal to confirm the import, so nothing was written.`,
        `-> Preview first: ${commandName} --dry-run`,
        `-> Then write without a prompt: ${commandName} --yes (or --json)`,
    ].join("\n");
}
