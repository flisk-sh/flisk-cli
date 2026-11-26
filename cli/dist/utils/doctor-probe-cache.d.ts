import type { CheckResult } from "../types/index.js";
import type { ExecAsync } from "./exec-async.js";
/**
 * The bind-mount and network probes cost about a second and answer what one project folder on one Docker install
 * rarely changes between runs, so a fresh verdict is trusted for a few minutes (`flisk doctor --no-probe-cache`
 * re-runs the probes anyway).
 */
export declare const DOCTOR_PROBE_TTL_MS: number;
/** Appended to a check message when the verdict comes from the stamp file instead of a live probe. */
export declare const CACHED_MARK = " (cached)";
/** What a probe verdict needs before it can be trusted again on a later run. */
export interface DoctorProbeEnvironment {
    /** Which Docker daemon the probes ran against: DOCKER_HOST plus the current docker context. */
    daemon: string;
    /** The Docker server version the probes ran against; empty when `docker version` could not be read. */
    version: string;
    /** False under `--no-probe-cache`: nothing is read from or written to the stamp file. */
    enabled: boolean;
    /** Home directory holding `.flisk/`; tests pass a temp dir. */
    home: string;
    /** Clock; tests inject one. */
    now: () => number;
}
export interface DoctorProbeEnvironmentOptions {
    enabled?: boolean;
    env?: Record<string, string | undefined>;
    home?: string;
    now?: () => number;
}
/**
 * Builds the identity a probe verdict is remembered under: the daemon identity (DOCKER_HOST and the current
 * context) plus the server version, so a Docker update or a context switch re-runs the probes. The server section
 * comes from the same `docker version` call the version checks share, so this costs nothing extra on a run.
 */
export declare function createDoctorProbeEnvironment(exec: ExecAsync, options?: DoctorProbeEnvironmentOptions): Promise<DoctorProbeEnvironment>;
/**
 * The remembered verdict for `probe` when it was stored for this daemon, version and scope within
 * DOCTOR_PROBE_TTL_MS; undefined otherwise. `name` is the CheckResult.name the check reports.
 */
export declare function readDoctorProbe(env: DoctorProbeEnvironment, probe: string, scope: string, name: string): CheckResult | undefined;
/**
 * Remembers a probe verdict for this daemon, version and scope. Skipped verdicts are never stored: they mean the
 * probe did not run, so the next run should try again. Best effort; the synchronous section keeps two checks in
 * one run from losing each other's entry.
 */
export declare function writeDoctorProbe(env: DoctorProbeEnvironment, probe: string, scope: string, result: CheckResult): void;
/** Drops every remembered probe verdict; `flisk doctor --fix` calls this so the next run re-probes what it changed. */
export declare function clearDoctorProbes(home?: string): void;
