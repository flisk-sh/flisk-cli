// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import { findProjectRoot } from "../../paths.js";
import { EXEC_TIMEOUT_MS } from "./shared.js";
const PID_AND_SEPARATOR = /^\s*(\d+)\s+/;
const TILT_UP = /\btilt(?:\.exe)?["']?\s+up\b/gi;
const F_FLAG = /\s-f\s+/i;
const DOUBLE_QUOTED = /^"([^"]+)"/;
const SINGLE_QUOTED = /^'([^']+)'/;
const GENERATED_TILTFILE = /^(.+[\\/]\.flisk[\\/]\.flisk-out[\\/]Tiltfile)(?=\s|$)/i;
const ANY_TILTFILE = /^(.+?[\\/]Tiltfile)(?=\s|$)/i;
const FIRST_TOKEN = /^(\S+)/;
// Prefer the full generated `<root>/.flisk/.flisk-out/Tiltfile` path before shorter fallbacks, so nested paths like
// `/repo/.flisk/Tiltfile demo/.flisk/.flisk-out/Tiltfile` never truncate at the earlier `Tiltfile` (#4165).
function tiltfileOf(after) {
    const flag = F_FLAG.exec(after);
    if (!flag)
        return undefined;
    const arg = after.slice(flag.index + flag[0].length);
    return (arg.match(DOUBLE_QUOTED)?.[1] ??
        arg.match(SINGLE_QUOTED)?.[1] ??
        arg.match(GENERATED_TILTFILE)?.[1] ??
        arg.match(ANY_TILTFILE)?.[1] ??
        arg.match(FIRST_TOKEN)?.[1]);
}
export function parseTiltProcesses(psOutput) {
    const processes = [];
    for (const line of psOutput.split("\n")) {
        const pid = line.match(PID_AND_SEPARATOR);
        if (!pid)
            continue;
        const command = line.slice(pid[0].length);
        // A `tilt up` only counts when a `-f` argument follows it; the last such occurrence wins.
        let tiltfile;
        for (const up of command.matchAll(TILT_UP)) {
            const candidate = tiltfileOf(command.slice(up.index + up[0].length));
            if (candidate !== undefined)
                tiltfile = candidate;
        }
        if (tiltfile === undefined)
            continue;
        // Only extract a project root from the complete generated `<root>/.flisk/.flisk-out/Tiltfile` path (#4123, #4165).
        const root = tiltfile.match(/^(.*)[\\/]\.flisk[\\/]\.flisk-out[\\/]Tiltfile$/i)?.[1] ?? tiltfile;
        processes.push({ pid: Number(pid[1]), root });
    }
    return processes;
}
function tiltProcessOutput(exec) {
    // An injected runner is the authority even on Windows, so tests and doctor contexts can supply their own output.
    if (exec)
        return exec("ps -Ao pid=,command=", { encoding: "utf-8", timeout: EXEC_TIMEOUT_MS });
    return process.platform === "win32"
        ? execFileSync(win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'tilt.exe' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }",
        ], { encoding: "utf-8", timeout: EXEC_TIMEOUT_MS, windowsHide: true })
        : // Absolute path and argv array: no shell, and no PATH lookup in a possibly writable directory.
            execFileSync("/bin/ps", ["-Ao", "pid=,command="], {
                encoding: "utf-8",
                timeout: EXEC_TIMEOUT_MS,
            });
}
/** All `tilt up -f <project>/.flisk/.flisk-out/Tiltfile` processes, or [] when processes cannot be listed. */
export function listTiltInstances(exec) {
    try {
        return parseTiltProcesses(tiltProcessOutput(exec));
    }
    catch {
        return [];
    }
}
export function checkTiltInstances(projectRoot = findProjectRoot() ?? process.cwd(), exec) {
    let running;
    try {
        running = parseTiltProcesses(tiltProcessOutput(exec));
    }
    catch {
        return {
            name: "Tilt processes",
            didPass: true,
            isSkipped: true,
            message: "Could not list processes",
        };
    }
    const mine = running.filter((p) => p.root === projectRoot);
    const others = running.filter((p) => p.root !== projectRoot);
    if (mine.length > 1) {
        return {
            name: "Tilt processes",
            didPass: false,
            message: `${mine.length} Tilt processes are running for this project (pids ${mine.map((p) => p.pid).join(", ")}). They fight over ports and containers`,
            fix: `Stop them all, then start one: flisk down && kill ${mine.map((p) => p.pid).join(" ")} && flisk up`,
        };
    }
    if (others.length > 0) {
        const list = others.map((p) => `${p.root} (pid ${p.pid})`).join(", ");
        return {
            name: "Tilt processes",
            didPass: true,
            isSkipped: true,
            message: `Another project's Tilt is running: ${list}`,
            fix: "flisk up will use the next free Tilt UI port (10351, ...). If it is a leftover, run flisk down in that project",
        };
    }
    return { name: "Tilt processes", didPass: true, message: "No stray Tilt processes" };
}
