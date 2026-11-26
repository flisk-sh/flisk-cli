// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { win32 } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import { createMachineEnvelope } from "../../utils/machine-output.js";
import { listProjectTemplates, PROJECT_TEMPLATES } from "../../utils/project-templates.js";
import { suggestClosest } from "../../utils/suggestions.js";
export const ACTION_WORD_HINTS = {
    validate: "flisk project --check",
    check: "flisk project --check",
    verify: "flisk project --check",
    info: "flisk info",
    list: "flisk resources",
    status: "flisk status",
};
/** Looks up an action word's hint; own keys only, so `constructor` and `__proto__` never match. */
export function actionWordHint(word) {
    const key = word.toLowerCase();
    return Object.hasOwn(ACTION_WORD_HINTS, key) ? ACTION_WORD_HINTS[key] : undefined;
}
/** Refuses an unknown starter name: prints the error and the catalog, then exits non-zero. */
export function exitUnknownTemplate(templateName) {
    const actionHint = actionWordHint(templateName);
    if (actionHint) {
        console.log(chalk.yellow(`\nDid you mean "${actionHint}"?`));
    }
    else {
        const closest = suggestClosest(templateName, Object.keys(PROJECT_TEMPLATES));
        if (closest) {
            console.log(chalk.yellow(`\nDid you mean "${closest}"?`));
        }
    }
    console.log(chalk.red(`\n❌ Unknown template: "${templateName}"`));
    console.log(chalk.yellow("\nAvailable templates:"));
    for (const [name, info] of Object.entries(PROJECT_TEMPLATES)) {
        console.log(`  ${chalk.cyan(name)} ${chalk.gray(`- ${info.description}`)}`);
    }
    console.log(chalk.gray("\nOr run `flisk project` with no template for a blank project."));
    process.exit(1);
}
const SAFE_WIN32_CD_RE = /^[A-Za-z0-9_.:\\/][A-Za-z0-9_.:\\/-]*$/;
const SAFE_POSIX_CD_RE = /^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/;
function escapeCmdTarget(raw, delayedExpansion) {
    if (SAFE_WIN32_CD_RE.test(raw))
        return raw;
    // In cmd.exe (/v:off), `%` expands even inside quotes so `%` is escaped outside quotes as `^%`,
    // while `!` and `^` remain literal inside quotes. When delayed expansion (/v:on) is enabled and
    // `!` is present, cmd parses carets twice: phase 2 consumes one caret outside quotes before phase 3
    // runs `!` expansion, so `^^^!` (-> `^!` -> `!`) and `^^^^` (-> `^^` -> `^`) stay outside quotes.
    const useDelayedBangEscaping = delayedExpansion && raw.includes("!");
    const specialRe = useDelayedBangEscaping ? /([%!^])/ : /([%])/;
    if (!specialRe.test(raw))
        return `"${raw.replace(/"/g, '""')}"`;
    return raw
        .split(specialRe)
        .filter((part) => part.length > 0)
        .map((part) => {
        if (part === "%")
            return "^%";
        if (useDelayedBangEscaping && part === "!")
            return "^^^!";
        if (useDelayedBangEscaping && part === "^")
            return "^^^^";
        return /^[A-Za-z0-9_.:\\/-]+$/.test(part) ? part : `"${part.replace(/"/g, '""')}"`;
    })
        .join("");
}
function escapePowerShellCdCommand(raw) {
    if (SAFE_WIN32_CD_RE.test(raw))
        return `cd ${raw}`;
    // Single quotes disable `$` and backtick expansion; `-LiteralPath` disables wildcard globbing (`[ ]`, `*`, `?`).
    return `Set-Location -LiteralPath '${raw.replace(/'/g, "''")}'`;
}
function resolveWindowsShell(env, shell) {
    const explicit = shell !== "auto"
        ? shell
        : env.FLISK_SHELL === "cmd" ||
            env.FLISK_SHELL === "cmd-delayed" ||
            env.FLISK_SHELL === "powershell" ||
            env.FLISK_SHELL === "posix"
            ? env.FLISK_SHELL
            : "auto";
    if (explicit !== "auto")
        return explicit;
    const hasPrompt = Boolean(env.PROMPT);
    const hasPwsh = Boolean(env.POWERSHELL_DISTRIBUTION_CHANNEL);
    const hasMsystem = Boolean(env.MSYSTEM);
    // Windows PowerShell 5.1 (`powershell.exe`) inherits `PROMPT` when launched from CMD and never
    // sets `POWERSHELL_DISTRIBUTION_CHANNEL`, while a nested `cmd.exe` from `pwsh` or Git Bash can
    // inherit parent shell variables. Only unnested `pwsh` or `MSYSTEM` (Git Bash) is unambiguous.
    if (hasPwsh && !hasPrompt && !hasMsystem)
        return "powershell";
    if (hasMsystem && !hasPrompt && !hasPwsh)
        return "posix";
    return "ambiguous";
}
/** Formats the created folder label and shell-safe `cd` next-step command(s) for the current OS and shell. */
export function formatProjectPaths(dirName, platform = process.platform, env = process.env, shell = "auto", workingDir = cwd()) {
    const isSeparator = (ch) => ch === "/" || (platform === "win32" && ch === "\\");
    let displayEnd = dirName.length;
    while (displayEnd > 0 && isSeparator(dirName.charAt(displayEnd - 1)))
        displayEnd--;
    const displayDir = platform === "win32" && /^[A-Za-z]:[\\/]+$/.test(dirName)
        ? `${dirName[0]}:\\`
        : dirName.length > 1
            ? dirName.slice(0, displayEnd) || dirName
            : dirName;
    const endsWithSep = displayDir.endsWith("/") || (platform === "win32" && displayDir.endsWith("\\"));
    const displayDirWithSlash = endsWithSep ? displayDir : `${displayDir}/`;
    const rawCdTarget = displayDir.startsWith("-")
        ? `${platform === "win32" ? ".\\" : "./"}${displayDir}`
        : displayDir;
    const isUncTarget = platform === "win32" && /^(\\\\|\/\/)/.test(rawCdTarget);
    const hasWinDrive = platform === "win32" && /^[A-Za-z]:/.test(rawCdTarget);
    const isSlashRooted = platform === "win32" && rawCdTarget.startsWith("/") && !isUncTarget;
    const isBackslashRooted = platform === "win32" && rawCdTarget.startsWith("\\") && !isUncTarget;
    const hasWinWorkingDirRoot = platform === "win32" && (/^[A-Za-z]:/.test(workingDir) || /^(\\\\|\/\/)/.test(workingDir));
    const resolvedWinRooted = (isSlashRooted || isBackslashRooted) && hasWinWorkingDirRoot
        ? win32.resolve(workingDir.replace(/\//g, "\\"), rawCdTarget)
        : null;
    const bashRawTarget = resolvedWinRooted ? resolvedWinRooted.replace(/\\/g, "/") : rawCdTarget;
    const isSafeBashTarget = resolvedWinRooted
        ? /^(?:[A-Za-z]:)?[A-Za-z0-9_./][A-Za-z0-9_./-]*$/.test(bashRawTarget)
        : SAFE_POSIX_CD_RE.test(bashRawTarget);
    const posixCdTarget = isSafeBashTarget
        ? bashRawTarget
        : `'${bashRawTarget.replace(/'/g, "'\\''")}'`;
    const posixCdCmd = `cd ${posixCdTarget}`;
    const detectedWinShell = platform === "win32" ? resolveWindowsShell(env, shell) : "posix";
    if (platform === "win32" && detectedWinShell !== "posix") {
        const isRelativeWinTarget = !hasWinDrive && !isUncTarget && !isSlashRooted && !isBackslashRooted;
        let cmdRawTarget = rawCdTarget;
        if (isUncTarget) {
            cmdRawTarget = rawCdTarget.replace(/\//g, "\\");
        }
        else if (resolvedWinRooted) {
            cmdRawTarget = resolvedWinRooted;
        }
        else if (isSlashRooted) {
            cmdRawTarget = rawCdTarget.replace(/\//g, "\\");
        }
        const isCmdUnc = /^\\\\/.test(cmdRawTarget);
        const hasCmdDrive = /^[A-Za-z]:/.test(cmdRawTarget);
        const isCharSafe = SAFE_WIN32_CD_RE.test(rawCdTarget);
        const hasBang = cmdRawTarget.includes("!");
        const formatCmd = (target) => isCmdUnc ? `pushd ${target}` : hasCmdDrive ? `cd /d ${target}` : `cd ${target}`;
        const cmdOffTarget = escapeCmdTarget(cmdRawTarget, false);
        const cmdOnTarget = escapeCmdTarget(cmdRawTarget, true);
        const cmdOffCmd = formatCmd(cmdOffTarget);
        const cmdOnCmd = formatCmd(cmdOnTarget);
        const psCmd = escapePowerShellCdCommand(rawCdTarget);
        const psTarget = isCharSafe ? rawCdTarget : `'${rawCdTarget.replace(/'/g, "''")}'`;
        if (detectedWinShell === "powershell") {
            return { displayDirWithSlash, cdTarget: psTarget, cdCommands: [psCmd] };
        }
        if (detectedWinShell === "cmd-delayed") {
            return { displayDirWithSlash, cdTarget: cmdOnTarget, cdCommands: [cmdOnCmd] };
        }
        if (detectedWinShell === "cmd") {
            return {
                displayDirWithSlash,
                cdTarget: cmdOffTarget,
                cdCommands: hasBang
                    ? [`cmd.exe:         ${cmdOffCmd}`, `cmd.exe (/v:on): ${cmdOnCmd}`]
                    : [cmdOffCmd],
            };
        }
        if (isCharSafe && isRelativeWinTarget && !rawCdTarget.includes("\\")) {
            return { displayDirWithSlash, cdTarget: rawCdTarget, cdCommands: [`cd ${rawCdTarget}`] };
        }
        return {
            displayDirWithSlash,
            cdTarget: cmdOffTarget,
            cdCommands: hasBang
                ? [
                    `cmd.exe:         ${cmdOffCmd}`,
                    `cmd.exe (/v:on): ${cmdOnCmd}`,
                    `PowerShell:      ${psCmd}`,
                    `Git Bash:        ${posixCdCmd}`,
                ]
                : [`cmd.exe:    ${cmdOffCmd}`, `PowerShell: ${psCmd}`, `Git Bash:   ${posixCdCmd}`],
        };
    }
    return { displayDirWithSlash, cdTarget: posixCdTarget, cdCommands: [posixCdCmd] };
}
/**
 * Prints the template catalog: with `json`, the usual envelope with the templates in `data.templates` (the same rows
 * as the `project_templates` MCP tool); otherwise one block per template with its key, description, repo, needs and ref.
 */
export function printTemplateCatalog(json) {
    const templates = listProjectTemplates();
    if (json) {
        console.log(JSON.stringify(createMachineEnvelope({ templates })));
        return;
    }
    console.log(chalk.bold("Starter templates (flisk project <key>):\n"));
    for (const { key, repo, description, needs, ref } of templates) {
        console.log(`  ${chalk.cyan(key)}  ${description}`);
        console.log(chalk.gray(`    ${repo}`));
        console.log(chalk.gray(`    needs: ${needs}`));
        if (ref)
            console.log(chalk.gray(`    ref ${ref}`));
    }
}
