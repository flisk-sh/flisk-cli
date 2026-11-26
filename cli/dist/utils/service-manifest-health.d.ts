/**
 * HTTP health check path (`healthCheckPath` and `healthCheck.path`). Allows safe path characters and
 * `${VAR}` / `${VAR:-default}` references (such as `${FLISK_CHECKOUT_ID}`), while rejecting spaces,
 * quotes, line breaks, and YAML syntax. Mirrors `health_path_ok` in `runtime/engine/topologies/tilt/manifest/parser.star`.
 */
export declare const HEALTH_PATH_PATTERN: RegExp;
export interface ParsedHealthCheckConfig {
    enabled: boolean;
    required?: boolean;
    interval?: number;
    timeout?: number;
    retries?: number;
    startPeriod?: number;
    path?: string;
    onFailure?: "report" | "restart";
}
/**
 * Validates the optional `healthCheck` field: boolean (e.g. false to disable) or an object
 * configuring enabled, required, interval, timeout, retries, and path/port/command.
 */
export declare function healthCheckErrors(manifest: Record<string, unknown>, displayPath: string): string[];
/** How a service shows it is ready: an HTTP path, an open TCP port, or a command that exits 0 (#2875). */
export type ReadinessProbe = {
    kind: "port";
    port: number;
} | {
    kind: "command";
    command: string[];
};
/** A manifest, or the `config` of a discovered resource, as the health check helpers read it. */
type HealthCheckSource = {
    healthCheck?: unknown;
    healthCheckPath?: unknown;
} | Readonly<Record<string, unknown>>;
/** `healthCheck.port` or `healthCheck.command`, when the service set one instead of an HTTP path. */
export declare function readinessProbeOf(manifest?: HealthCheckSource): ReadinessProbe | undefined;
/**
 * The one rule for turning health checks off: `healthCheck: false` or `healthCheck: { enabled: false }`.
 * Nothing else disables them: a service without a health path still gets its default readiness
 * signal (its port for a native `command` service, `/health` for a container).
 */
export declare function isHealthCheckDisabled(manifest?: HealthCheckSource): boolean;
/**
 * True when the service explicitly marks its health check as non-blocking (`healthCheck: { required: false }`).
 * Defaults to false (health checks are required). Returns false when health checks are disabled entirely.
 */
export declare function isHealthCheckOptional(manifest?: HealthCheckSource): boolean;
/** The HTTP path to probe: `healthCheck.path`, then `healthCheckPath`, then `fallback`. */
export declare function healthCheckPathOf(manifest?: HealthCheckSource, fallback?: string): string | undefined;
/**
 * Reads a manifest's health check settings. `enabled` follows {@link isHealthCheckDisabled}; `path` follows
 * {@link healthCheckPathOf} and is absent when neither the manifest nor `options.defaultPath` gives one.
 */
export declare function parseHealthCheckConfig(manifest?: HealthCheckSource, options?: {
    defaultPath?: string;
}): ParsedHealthCheckConfig;
export {};
