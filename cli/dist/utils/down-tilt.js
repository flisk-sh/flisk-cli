// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
const run = (command, args) => execFileSync(command, args, { encoding: "utf-8", stdio: "pipe", windowsHide: true });
// Unlike `run`, this lets the independent `down` probes overlap instead of blocking the event loop (#4173).
const execFileAsync = promisify(execFile);
export const runAsync = async (command, args) => {
    const { stdout } = await execFileAsync(command, args, {
        encoding: "utf-8",
        windowsHide: true,
    });
    return stdout;
};
/**
 * The one process-table read used by every down discovery path. Throws when `ps` cannot be read so callers can choose
 * between "no process" and "could not look"; the Windows caller treats the platform as having no process table.
 */
export function readProcessTable(platform = process.platform, commandRunner = run) {
    if (platform === "win32")
        return [];
    return parseProcessTable(commandRunner("ps", ["-axo", "pid=,command="]));
}
export function parseProcessTable(output) {
    const entries = [];
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\S.*)$/.exec(line);
        if (!match)
            continue;
        entries.push({ pid: Number(match[1]), command: match[2] ?? "" });
    }
    return entries;
}
/** The program a command line starts, without its folders. */
export function processExecutable(command) {
    return (command.split(/\s+/)[0] ?? "").split(/[\\/]/).at(-1) ?? "";
}
const PROJECT_TILTFILE_SUFFIX = "/.flisk/.flisk-out/Tiltfile";
/**
 * The win32 counterpart of `ps -axo pid=,command=`: Tilt processes as `pid<TAB>commandLine`, following the PowerShell
 * pattern of `tilt-process.ts`. Reading the command line here (rather than filtering in PowerShell) keeps the Tiltfile
 * matching identical on every platform, including paths with spaces.
 */
const WINDOWS_TILT_PROCESS_SCRIPT = "Get-CimInstance Win32_Process -Filter \"Name = 'tilt.exe'\" -ErrorAction SilentlyContinue | " +
    'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
/** Null means the process list could not be read, as opposed to an empty list meaning nothing is running. */
function windowsTiltProcesses(commandRunner) {
    let output;
    try {
        output = commandRunner("powershell.exe", [
            "-NoProfile",
            "-Command",
            WINDOWS_TILT_PROCESS_SCRIPT,
        ]);
    }
    catch {
        return null;
    }
    const processes = [];
    // Windows PowerShell may write UTF-16 to a redirected stdout; dropping the NUL bytes keeps plain ASCII fields intact.
    for (const line of output.replace(/\0/g, "").split(/\r?\n/)) {
        const match = /^\s*(\d+)\t(.*)$/.exec(line);
        if (!match)
            continue;
        processes.push({ pid: Number(match[1]), commandLine: match[2] ?? "" });
    }
    return processes;
}
const TILT_UP = /(?:^|\s)up(?:\s|$)/i;
const FILE_FLAG_PATH = /(?:^|\s)(?:-f|--file)\s+(?:"([^"]+)"|(\S+))(?=\s|$)/i;
function normalizeWindowsPath(path) {
    return path.replace(/\\/g, "/");
}
/** The executable at the start of a Windows command line, quoted paths included. */
function windowsExe(commandLine) {
    const trimmed = commandLine.trimStart();
    if (trimmed.startsWith('"'))
        return trimmed.slice(1, trimmed.indexOf('"', 1));
    return trimmed.split(/\s+/)[0] ?? "";
}
function isTiltUpCommandLine(commandLine) {
    return /(?:^|[\\/])tilt(?:\.exe)?$/i.test(windowsExe(commandLine)) && TILT_UP.test(commandLine);
}
/** True for a `tilt up` whose `-f`/`--file` is exactly this Tiltfile (also when the path was quoted or used `/`). */
function matchesWindowsTiltUp(process, tiltfilePath) {
    if (!isTiltUpCommandLine(process.commandLine))
        return false;
    const match = FILE_FLAG_PATH.exec(normalizeWindowsPath(process.commandLine));
    const flagValue = match?.[1] ?? match?.[2];
    if (!flagValue)
        return false;
    return (normalizeWindowsPath(flagValue).toLowerCase() ===
        normalizeWindowsPath(tiltfilePath).toLowerCase());
}
/** The Flisk Tiltfile a `tilt up` command line was started with, or null for any other command. */
function tiltfileFromWindowsCommandLine(commandLine) {
    if (!isTiltUpCommandLine(commandLine))
        return null;
    const match = FILE_FLAG_PATH.exec(normalizeWindowsPath(commandLine));
    const flagValue = match?.[1] ?? match?.[2];
    if (!flagValue)
        return null;
    const tiltfile = normalizeWindowsPath(flagValue);
    return tiltfile.endsWith(PROJECT_TILTFILE_SUFFIX) ? tiltfile : null;
}
/** Project roots with a `tilt up` on their Flisk Tiltfile among the Windows processes (duplicates kept out). */
export function windowsTiltUpRoots(commandRunner = run) {
    const roots = [];
    for (const process of windowsTiltProcesses(commandRunner) ?? []) {
        const tiltfile = tiltfileFromWindowsCommandLine(process.commandLine);
        if (!tiltfile)
            continue;
        const root = tiltfile.slice(0, -PROJECT_TILTFILE_SUFFIX.length).replace(/\//g, "\\");
        if (!roots.includes(root))
            roots.push(root);
    }
    return roots;
}
/**
 * Like {@link findProjectTiltUpPids}, but null when the process list cannot be read (`ps` or PowerShell fails),
 * so a caller can tell "no tilt up" from "could not look".
 */
export function lookupProjectTiltUpPids(tiltfilePath, platform = process.platform, commandRunner = run) {
    if (platform === "win32") {
        const processes = windowsTiltProcesses(commandRunner);
        if (processes === null)
            return null;
        return processes
            .filter((process) => matchesWindowsTiltUp(process, tiltfilePath))
            .map((p) => p.pid);
    }
    let entries;
    try {
        entries = readProcessTable(platform, commandRunner);
    }
    catch {
        return null;
    }
    // An empty table can also mean `ps` failed inside the reader; the caller cannot tell either way, and treats it as none.
    return tiltUpPidsIn(entries, tiltfilePath);
}
export function tiltUpPidsIn(entries, tiltfilePath) {
    const pids = [];
    for (const { pid, command } of entries) {
        const target = ` -f ${tiltfilePath}`;
        const at = command.indexOf(target);
        const boundary = command[at + target.length];
        if (processExecutable(command) === "tilt" &&
            /^\S+\s+up\s/.test(command) &&
            at > 0 &&
            (boundary === undefined || boundary === " ")) {
            pids.push(pid);
        }
    }
    return pids;
}
/**
 * PIDs of `tilt up` processes started for this project's Tiltfile. Matching on the Tiltfile path keeps another
 * project's Tilt (or a Tilt the user started by hand) untouched.
 */
export function findProjectTiltUpPids(tiltfilePath, platform = process.platform, commandRunner = run) {
    return lookupProjectTiltUpPids(tiltfilePath, platform, commandRunner) ?? [];
}
export function stopProjectTiltUp(tiltfilePath, platform = process.platform, commandRunner = run) {
    const pids = findProjectTiltUpPids(tiltfilePath, platform, commandRunner);
    for (const pid of pids) {
        try {
            if (platform === "win32")
                commandRunner("taskkill.exe", ["/PID", String(pid), "/F"]);
            else
                commandRunner("kill", ["-TERM", String(pid)]);
        }
        catch {
            // Already gone.
        }
    }
    return pids;
}
/** Wait (up to `timeoutMs`) for the `tilt up` processes to exit after TERM, so `tilt down` does not race a live Tilt. */
export async function waitForTiltUpExit(tiltfilePath, timeoutMs = 8000, findPids = findProjectTiltUpPids) {
    const deadline = Date.now() + timeoutMs;
    while (findPids(tiltfilePath).length > 0) {
        if (Date.now() >= deadline)
            return false;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return true;
}
