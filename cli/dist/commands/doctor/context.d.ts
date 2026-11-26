import type { execSync } from "node:child_process";
import type { DiscoveredResource, HostPortPlan } from "../../types/index.js";
import type { HostInfo } from "../../utils/agent-host.js";
import type { DiskRuntime } from "../../utils/disk-guard.js";
import type { DoctorProbeEnvironment } from "../../utils/doctor-probe-cache.js";
import type { ExecAsync } from "../../utils/exec-async.js";
import type { HostCommandCache } from "../../utils/host-command-cache.js";
/** The `flisk doctor` flags, as the commander action parses them. */
export interface DoctorOptions extends Record<string, unknown> {
    all?: boolean;
    problemsOnly?: boolean;
    json?: boolean;
    ping?: boolean;
    probeCache?: boolean;
    gateway?: boolean;
    database?: boolean;
    dockerProbe?: boolean;
    dockerProbeTimeout?: string;
    strict?: boolean;
    agents?: boolean;
    fix?: boolean;
    dryRun?: boolean;
    scope?: string;
    yes?: boolean;
    pingTimeout?: string;
}
/**
 * Everything one `flisk doctor` run collected before its check table expands: the flags,
 * what the run learned about the host and project, and the probes the checks share
 * (one host-command cache and one compose-version exec per run).
 */
export interface DoctorRunContext {
    options: DoctorOptions;
    host: HostInfo;
    projectRoot: string | null;
    /** `projectRoot ?? process.cwd()`: the directory file-based checks inspect. */
    checkDir: string;
    /** The project's services when they all declare `command` (a local-process project). */
    nativeResources: DiscoveredResource[] | null;
    includeWslChecks: boolean;
    gatewayEnabled: boolean;
    dbEnabled: boolean;
    portCaps: {
        gateway: boolean;
        database: boolean;
    };
    hostPortPlan: HostPortPlan | null | undefined;
    portPlanError: string | undefined;
    hostCommandCache: HostCommandCache;
    cachedExec: ExecAsync;
    /** Lazily memoized near-miss service.json keys ("comand" for "command"): a typo can hide a local-process `command`, so failing container checks name it. */
    manifestTypoNotes: () => string[];
    /** Resolved lazily and memoized: the file-sharing and network probes share one resolved identity. */
    probeEnv: () => Promise<DoctorProbeEnvironment>;
    /** Hard timeout for the Docker bind-mount probe, in milliseconds. */
    dockerProbeTimeout: number;
    /** What the disk check sizes for: a mixed local-process run still needs Docker for its image services. */
    diskRuntime: DiskRuntime;
    execSync: typeof execSync;
    pingTimeout: number;
    /** The port a running stack is actually on, for the ping checks. */
    pingPort: number | undefined;
}
