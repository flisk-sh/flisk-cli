import type { Command } from "commander";
import type { ServiceRuntimeState } from "../../types/index.js";
import { type ServiceUsage, type ServiceUsageTarget } from "../../utils/service-usage.js";
/** The options `flisk status` accepts; the action reads each flag off this bag. */
export type StatusActionOptions = {
    json?: boolean;
    verbose?: boolean;
    stacks?: boolean;
    stack?: string;
    resources?: boolean;
    tilt?: boolean;
    gateway?: boolean;
    unhealthy?: boolean;
    strict?: boolean;
    usage?: boolean;
    project?: string;
    [key: string]: unknown;
};
/** One compact suffix on a service line. `null` covers stopped services, Windows and unreadable samples. */
export declare function formatServiceUsage(usage: ServiceUsage | null, platform: NodeJS.Platform): string;
/** The services a usage sample should look for: recorded pids here, container names for Docker services. */
export declare function usageTargets(resources: readonly {
    name: string;
    stack?: string | null;
}[], nativeStates: Record<string, ServiceRuntimeState> | null, nativeRunServices: Record<string, {
    pid?: number;
    container?: string;
}> | null, projectName: string | null): ServiceUsageTarget[];
/**
 * The `flisk status` implementation: discovery, the native-runtime and Tilt probes, the `--json` envelope or the
 * printed report, and the `--strict` exit code. Errors go through `writeMachineError` for `--json`, `runCommand`
 * otherwise, the same as before this moved out of `status.ts`.
 */
export declare function statusAction(options: StatusActionOptions, command: Command): Promise<void>;
