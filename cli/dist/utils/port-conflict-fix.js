import { getPortSetting } from "./port-owner.js";
/** The host port a conflict message is about, or null when the message is not a port conflict. */
export function conflictPort(message) {
    // The raw Docker error can reach the report when the readiness check fails before the summary runs.
    const match = message.match(/^host port (\d+) is already allocated$/) ??
        message.match(/Bind for [^ ]+:(\d+) failed: port is already allocated/i);
    if (!match)
        return null;
    const [, port] = match;
    return port ? Number(port) : null;
}
/**
 * The next step for a host port another process already holds. When the occupant is known it is named; otherwise the
 * command that finds it is given instead.
 */
export function portConflictFix(message, occupant = null) {
    const port = conflictPort(message);
    if (port === null)
        return null;
    // getPortSetting knows the preferred ports and the fallback ranges, so a conflict on a fallback port
    // the plan picked (15432, not just 5432) still names the setting that moves it (#4216).
    const envVar = getPortSetting(port);
    const body = occupant?.container
        ? `Fix: port ${port} is held by the Docker container ${occupant.container}. Stop it (docker stop ${occupant.container})`
        : occupant
            ? `Fix: port ${port} is held by ${occupant.command} (pid ${occupant.pid}). Stop it`
            : `Fix: stop the process using port ${port} (find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN)`;
    return envVar ? `${body}, or set ${envVar} to a free port and run flisk up` : body;
}
