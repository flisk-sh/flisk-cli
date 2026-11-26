import { type HealthProbeDetail } from "./up-readiness.js";
export interface StartupReport {
    failed: Array<{
        name: string;
        message: string;
        probe?: HealthProbeDetail;
    }>;
    /**
     * Depending, directly or through other services, on something that failed. Such a service is not ready even when its
     * own container runs: Tilt starts dependents once a dependency's container runs, before its health check passes.
     */
    blocked: Array<{
        name: string;
        because: string[];
    }>;
    /** Not ready with nothing failed upstream: still building or starting. */
    starting: string[];
    /** Services whose images were still actively building when timed out. */
    stillBuilding?: string[];
    /** Last log lines for services that timed out. */
    lastLogs?: Record<string, string>;
}
export declare function transitiveDependencies(name: string, dependsOn: Record<string, string[]>): Set<string>;
/**
 * Shared resources every service needs. When one of them fails, nothing still pending can become ready, so the wait
 * ends at the next poll instead of when the last unrelated image build finishes (#4125). An image build is a Tilt
 * resource of its own with no dependencies, so the dependency graph alone never links it to a failed postgres.
 */
export declare const SHARED_INFRASTRUCTURE: string[];
export declare function buildStartupReport(jsonText: string, dependsOn: Record<string, string[]>, deferred?: Set<string>): StartupReport;
/** A failure exists and everything still pending is blocked by it, so waiting longer cannot help. */
export declare function isStartupStalled(jsonText: string, dependsOn: Record<string, string[]>, deferred?: Set<string>): boolean;
