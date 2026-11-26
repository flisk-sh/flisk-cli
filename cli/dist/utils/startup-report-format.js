// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { conflictPort, portConflictFix } from "./port-conflict-fix.js";
import { machineProblemFix } from "./startup-fixes.js";
import { lastLines } from "./startup-logs.js";
/** `probe: [curl -f http://localhost:8000/health] -> exec: "curl": executable file not found` (#3056). */
function probeText(probe) {
    const command = probe.command.length > 0 ? probe.command.join(" ") : "(no probe)";
    const output = probe.output || `exit ${probe.exitCode ?? "unknown"}`;
    return `[${command}] -> ${output}`;
}
export function formatStartupReport(report, timedOut, occupantOf, machineFixes = new Map(), lastLogs) {
    const lines = [];
    for (const { name, message, probe } of report.failed) {
        lines.push(`✗ ${name} failed: ${message}`);
        const port = conflictPort(message);
        const fix = portConflictFix(message, port !== null && occupantOf ? occupantOf(port) : null) ??
            machineFixes.get(name) ??
            machineProblemFix(message);
        if (fix)
            lines.push(`  ${fix}`);
        if (probe)
            lines.push(`  probe: ${probeText(probe)}`);
    }
    for (const { name, because } of report.blocked) {
        lines.push(`✗ ${name} is not ready because ${because.join(", ")} failed`);
    }
    if (report.stillBuilding && report.stillBuilding.length > 0) {
        lines.push(`${timedOut ? "Timed out while building:" : "Still building:"} ${report.stillBuilding.join(", ")}`);
    }
    const startingOnly = report.starting.filter((s) => !report.stillBuilding?.includes(s));
    if (startingOnly.length > 0) {
        lines.push(`${timedOut ? "Timed out waiting for" : "Still starting:"} ${startingOnly.join(", ")}`);
    }
    const combinedLogs = { ...(report.lastLogs ?? {}), ...(lastLogs ?? {}) };
    const timedOutServices = [...(report.stillBuilding ?? []), ...startingOnly];
    if (timedOut) {
        for (const name of timedOutServices) {
            const logs = combinedLogs[name]?.trim();
            if (logs) {
                lines.push(`Last log lines for ${name}:`);
                for (const logLine of logs.split("\n").slice(-10)) {
                    lines.push(`  ${logLine}`);
                }
            }
        }
    }
    if (lines.length > 0) {
        const causes = [...new Set(report.blocked.flatMap((entry) => entry.because))].sort((a, b) => a.localeCompare(b));
        const count = report.blocked.length;
        const summary = count > 0
            ? `: ${causes.join(", ")} failed, so ${count} dependent ${count === 1 ? "service is" : "services are"} not ready`
            : "";
        lines.push(`The environment is not ready${summary}. Tilt is still running; inspect it or run: flisk down`);
    }
    return lines;
}
/**
 * The detail under "Resources failed": one entry per distinct reason, with the number and names of the resources that
 * printed it. Each entry ends with the reason so a build's `ERROR:` line stays the last thing the user reads (#3958).
 */
export function formatFailureDetail(failures) {
    const groups = new Map();
    for (const failure of failures) {
        const group = groups.get(failure.message) ?? { names: [], fix: failure.fix, probes: [] };
        group.names.push(failure.name);
        if (failure.probe)
            group.probes.push({ name: failure.name, probe: failure.probe });
        groups.set(failure.message, group);
    }
    return [...groups.entries()]
        .map(([message, group]) => {
        const names = group.names;
        const label = names.length === 1
            ? `${names[0]}:`
            : `${names.length} resources failed the same way (${names.join(", ")}):`;
        const probeLines = group.probes
            .map(({ name, probe }) => names.length === 1
            ? `    probe: ${probeText(probe)}`
            : `    ${name} probe: ${probeText(probe)}`)
            .join("\n");
        return `${group.fix ? `${label} ${group.fix.replace(/^Fix:\s*/, "")}` : label}\n${message}${probeLines ? `\n${probeLines}` : ""}`;
    })
        .join("\n");
}
/**
 * The failure lines `flisk up --wait` prints from the `flisk up --json` result: each failed resource and its reason,
 * and under it the fix when the reason names a known machine problem.
 */
export function formatWaitFailures(failures) {
    return failures.map((f) => {
        const lines = [`${f.name}: ${f.reason ?? f.message ?? "failed"}`];
        if (f.fix)
            lines.push(`    → ${f.fix.replace(/^Fix:\s*/, "")}`);
        if (f.probe)
            lines.push(`    probe: ${probeText(f.probe)}`);
        if (f.logs && f.logs.length > 0) {
            lines.push(...f.logs.map((line) => `    ${line}`));
            lines.push(`    (${lastLines(f.logs.length)} of: flisk logs --service ${f.name})`);
        }
        return lines.join("\n");
    });
}
