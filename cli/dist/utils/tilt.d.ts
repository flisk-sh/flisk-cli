import type { TiltCommandResult } from "../types/index.js";
export declare function runTilt(command: string, args?: string[], options?: {
    verbose?: boolean;
    quiet?: boolean;
    inheritStdio?: boolean;
    timeoutMs?: number;
}): Promise<TiltCommandResult>;
export declare function isTiltAvailable(): Promise<boolean>;
/**
 * Invalidates the memoised PATH lookup. Production code never changes PATH mid-process,
 * but tests that install fake tools do, and must not inherit an earlier answer.
 */
export declare function resetTiltAvailabilityCache(): void;
export declare function getTiltfilePath(): string;
export declare function buildTiltUpArgs(serviceNames: string[], options?: {
    verbose?: boolean;
    quiet?: boolean;
    force?: boolean;
    watch?: boolean;
    focusTargets?: string[];
}): string[];
export declare function buildTiltDownArgs(options?: {
    force?: boolean;
    yes?: boolean;
    focusTargets?: string[];
}): string[];
