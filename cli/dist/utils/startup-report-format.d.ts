import type { PortOccupant } from "../types/index.js";
import type { StartupReport } from "./startup-report.js";
import type { HealthProbeDetail } from "./up-readiness.js";
export declare function formatStartupReport(report: StartupReport, timedOut: boolean, occupantOf?: (port: number) => PortOccupant | null, machineFixes?: Map<string, string>, lastLogs?: Record<string, string>): string[];
/**
 * The detail under "Resources failed": one entry per distinct reason, with the number and names of the resources that
 * printed it. Each entry ends with the reason so a build's `ERROR:` line stays the last thing the user reads (#3958).
 */
export declare function formatFailureDetail(failures: Array<{
    name: string;
    message: string;
    fix?: string;
    probe?: HealthProbeDetail;
}>): string;
/**
 * The failure lines `flisk up --wait` prints from the `flisk up --json` result: each failed resource and its reason,
 * and under it the fix when the reason names a known machine problem.
 */
export declare function formatWaitFailures(failures: Array<{
    name: string;
    reason?: string;
    message?: string;
    fix?: string;
    probe?: HealthProbeDetail;
    logs?: string[];
}>): string[];
