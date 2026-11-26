// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { isPortPublishFailure, summarizeTiltBuildError } from "./doctor-runtime.js";
import { conflictPort, portConflictFix } from "./port-conflict-fix.js";
import { buildOutputTail, capEnd, capStart, loggedErrorLine, logTail } from "./startup-logs.js";
import { stripTerminalControls } from "./tilt-events.js";
// Docker has no free subnet left for a new network (every project creates several and `flisk down` keeps them).
// Docker words it "fully subnetted" on one version and "non-overlapping IPv4 address pool" on another; the last is our own text.
const NETWORK_POOL_EXHAUSTED = /all predefined address pools have been fully subnetted|non-overlapping IPv4 address pool|out of network address pools/i;
/** What a failed `init-networks` says when its log gives no reason: the usual cause, in plain words, not the shell command. */
const INIT_NETWORKS_FALLBACK = "Docker could not create this project's networks; it is most likely out of network address pools";
/**
 * Tilt's error for a failed local command is only "exit status 1"; the reason (for example Docker's "all predefined
 * address pools have been fully subnetted") is in the resource's log. Returns the fix for each failed resource whose
 * message or log names a known machine problem.
 */
export async function machineProblemFixes(failures, fetchLogs) {
    const fixes = new Map();
    for (const { name, message } of failures.slice(0, 5)) {
        const fix = machineProblemFix(message) ?? machineProblemFix((await fetchLogs(name)) ?? "");
        if (fix)
            fixes.set(name, fix);
    }
    return fixes;
}
/** A plain fix for a failure message that names a known machine problem, or null. */
export function machineProblemFix(message) {
    if (NETWORK_POOL_EXHAUSTED.test(message)) {
        return "Fix: Docker has no free network ranges left. Run `flisk doctor --fix --scope=machine` to remove the unused networks of every Flisk project (networks in use are kept), or `flisk down --prune-networks` in a stopped project, or `docker network prune` for all unused networks, then run flisk up again";
    }
    return null;
}
// What Tilt reports for a local_resource whose command exited non-zero: no reason at all.
const BARE_EXIT_STATUS = /^(?:Command failed: )?exit status \d+$/i;
// What Tilt reports for a failed local command (`Command "..." failed`) or compose step (`command [...] failed`): the
// command line, often hundreds of characters, and not why it failed.
const FAILED_COMMAND = /^command\s+(?:"[\s\S]*"|\[[\s\S]*\])\s+failed\b/i;
/**
 * Failures whose message carries no reason, given the reason their command logged instead. The health gates
 * (`postgres-healthy`, `<svc>-healthy`, `<job>-done`) print the cause as their last `ERROR: ...` line, such as a container
 * that exited or a health check that kept failing past its recovery window, so `flisk up` shows that rather than
 * "exit status 1" (#3210). A failed command or compose step (`init-networks`, `docker compose up`) is shown as the last
 * lines of its log, where Docker's own message is, rather than the command line (#3822). An image build keeps the
 * `ERROR:` line and the four lines before it, which is what Docker actually said (#3958). A reason taken from a log is
 * stripped of terminal escapes and cut to MAX_FAILURE_MESSAGE characters. Other failures, and those whose log has
 * nothing to show, are returned unchanged, with the command text cut to MAX_FAILURE_MESSAGE characters. Only the
 * first five failures have their log read; resources that printed the same command reuse that reason.
 */
export async function withLoggedReasons(failures, fetchLogs) {
    const out = [];
    const summarize = (failure) => isPortPublishFailure(failure.message)
        ? { ...failure, message: summarizeTiltBuildError(failure.message) }
        : failure;
    const reasonByCommand = new Map();
    for (const [index, failure] of failures.entries()) {
        const message = failure.message.trim();
        const isBareExit = BARE_EXIT_STATUS.test(message);
        // Tilt's error can be cut to 220 characters before it reaches here, so "failed: exit status 1" may be gone.
        const isCommand = FAILED_COMMAND.test(message) || /^command\s+"/i.test(message);
        const key = isCommand ? message : null;
        if (!isBareExit && !isCommand) {
            out.push(failure);
            continue;
        }
        if (key && reasonByCommand.has(key)) {
            out.push({ ...failure, message: capEnd(reasonByCommand.get(key)) });
            continue;
        }
        if (index >= 5) {
            out.push(isCommand ? { ...failure, message: capStart(message) } : failure);
            continue;
        }
        const log = stripTerminalControls((await fetchLogs(failure.name)) ?? "");
        const buildTail = isCommand ? buildOutputTail(log) : null;
        const errorLine = loggedErrorLine(log);
        const reason = buildTail ?? (errorLine ? capStart(errorLine.trim()) : isCommand ? logTail(log) : null);
        if (reason) {
            if (key && buildTail)
                reasonByCommand.set(key, buildTail);
            out.push({ ...failure, message: buildTail ? capEnd(reason) : reason });
        }
        else if (isCommand && failure.name === "init-networks")
            out.push({ ...failure, message: INIT_NETWORKS_FALLBACK });
        else if (isCommand)
            out.push({ ...failure, message: capStart(message) });
        else
            out.push(failure);
    }
    // A host port publish refusal is reported as the port, not the compose command line that hit it (#4216).
    return out.map(summarize);
}
/**
 * Failures with the reason their log gives (withLoggedReasons) and, when that reason names a known machine problem,
 * its fix, for both the `flisk up --json` result and its error message. A host port publish refusal also names the
 * container or process that holds the port when `occupantOf` can identify it (#4216).
 */
export async function explainFailures(failures, fetchLogs, occupantOf) {
    const explained = await withLoggedReasons(failures, fetchLogs);
    const fixes = await machineProblemFixes(explained, fetchLogs);
    return explained.map((failure) => {
        const port = conflictPort(failure.message);
        const occupant = port === null ? null : (occupantOf?.(port) ?? null);
        const fix = fixes.get(failure.name) ?? portConflictFix(failure.message, occupant);
        return fix ? { ...failure, fix } : failure;
    });
}
