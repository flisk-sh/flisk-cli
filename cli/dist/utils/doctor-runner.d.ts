/** Runs doctor checks, skips container checks once the runtime failed, and orders and summarises results. */
import type { CheckResult } from "../types/index.js";
import type { ExecAsync } from "./exec-async.js";
/** Failures are shown before passing statuses, with a 5432 conflict first. */
export declare function orderDoctorResults(results: CheckResult[]): CheckResult[];
export declare function getDoctorOutcomeMessage(inProject: boolean, allPassed: boolean): string;
export type DoctorCheckFn = ((exec?: ExecAsync) => CheckResult | Promise<CheckResult>) & {
    requiresContainerRuntime?: boolean;
    checkName?: string;
    /** Display name used by progress output; resolved per check when not set explicitly. */
    progressName?: string;
};
/** Human name for a check function's JS name: `checkDockerVersions` becomes `Docker Versions`. */
export declare function prettyCheckFunctionName(fnName: string | undefined): string | undefined;
/** The name progress output and skip messages use for a check before its result is known. */
export declare function doctorCheckName(check: DoctorCheckFn): string;
/** Attaches the display name progress output and skip messages should use for a check. */
export declare function namedCheck(checkName: string, check: () => CheckResult | Promise<CheckResult>): DoctorCheckFn;
/** Per-check lifecycle events; a stuck check is the one that started but never finished. */
export interface DoctorCheckProgress {
    onCheckStart?: (check: DoctorCheckFn) => void;
    onCheckFinish?: (check: DoctorCheckFn, result?: CheckResult) => void;
}
export declare const CONTAINER_CHECK_NAMES_MAP: Record<string, string>;
export declare const CONTAINER_DEPENDENT_CHECK_NAMES: Set<string>;
export declare function isContainerDependentCheck(check: DoctorCheckFn): boolean;
export declare function requiresContainerRuntime(checkName: string, check: () => CheckResult | Promise<CheckResult>): DoctorCheckFn;
export declare function runChecks(checks: DoctorCheckFn[], options?: {
    all?: boolean;
    containerRuntimeFailed?: boolean;
} & DoctorCheckProgress): Promise<CheckResult[]>;
export declare function formatDoctorSummary(results: CheckResult[]): string;
