import type { PortOccupant } from "../types/index.js";
/**
 * Tilt's error for a failed local command is only "exit status 1"; the reason (for example Docker's "all predefined
 * address pools have been fully subnetted") is in the resource's log. Returns the fix for each failed resource whose
 * message or log names a known machine problem.
 */
export declare function machineProblemFixes(failures: Array<{
    name: string;
    message: string;
}>, fetchLogs: (name: string) => Promise<string | null>): Promise<Map<string, string>>;
/** A plain fix for a failure message that names a known machine problem, or null. */
export declare function machineProblemFix(message: string): string | null;
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
export declare function withLoggedReasons<T extends {
    name: string;
    message: string;
}>(failures: T[], fetchLogs: (name: string) => Promise<string | null>): Promise<T[]>;
/**
 * Failures with the reason their log gives (withLoggedReasons) and, when that reason names a known machine problem,
 * its fix, for both the `flisk up --json` result and its error message. A host port publish refusal also names the
 * container or process that holds the port when `occupantOf` can identify it (#4216).
 */
export declare function explainFailures<T extends {
    name: string;
    message: string;
}>(failures: T[], fetchLogs: (name: string) => Promise<string | null>, occupantOf?: (port: number) => PortOccupant | null): Promise<Array<T & {
    fix?: string;
}>>;
