export interface HealthCheckObjectConfig {
    enabled?: boolean;
    /** Whether a failing health check blocks stack readiness (`flisk up` / `flisk up --wait`). Defaults to true. */
    required?: boolean;
    interval?: number;
    timeout?: number;
    retries?: number;
    /** Seconds after start before failed probes count (Compose start_period). */
    startPeriod?: number;
    path?: string;
    /** Ready when this TCP port accepts a connection (#2875). */
    port?: number;
    /** Ready when this command exits 0: the program and its arguments (#2875). */
    command?: string[];
    /** What a native process does when periodic re-probes find it unhealthy (#4692). Defaults to "report". */
    onFailure?: "report" | "restart";
}
export type HealthCheckConfig = boolean | HealthCheckObjectConfig;
export interface ContainerConfig {
    /** Start command (Compose command), replacing the image's CMD: a list of arguments such as ["server", "/data"]. */
    command?: string[];
    /** Entrypoint (Compose entrypoint), replacing the image's ENTRYPOINT: a list of arguments such as ["/docker-entrypoint.sh"]. */
    entrypoint?: string[];
    init?: boolean;
    readOnly?: boolean;
    user?: string;
    shmSize?: string;
    tmpfs?: string[];
    gpus?: string | number;
    cpus?: string | number;
    memory?: string;
    ipc?: string;
    stopGracePeriod?: string;
    extraHosts?: string[];
    ulimits?: Record<string, number | {
        soft: number;
        hard: number;
    }>;
    networkAliases?: string[];
    capAdd?: string[];
    capDrop?: string[];
    securityOpt?: string[];
}
