import type { RESOURCE_CONFIG_APP_TYPES } from "./app-types.js";
import type { AgentConfig, DevConfig } from "./dev-config.js";
import type { ContainerConfig, HealthCheckConfig } from "./health.js";
export interface ResourceConfigFields {
    appName: string;
    appType: (typeof RESOURCE_CONFIG_APP_TYPES)[number];
    stack?: string;
    schemaVersion?: number;
    port?: number;
    replicas?: number;
    runtime?: string;
    featuresEnabled?: string[];
    /**
     * Names after discovery. service.json may also write `{ "name": "db", "condition": "service_healthy" }` entries
     * (dependsOnErrors checks them); parseResource turns them into their names.
     */
    dependsOn?: string[];
    /** Deprecated spelling of dependsOn; still read, and counted with it. */
    dependencies?: string[];
    enabled?: boolean;
    basePath?: string;
    backendName?: string;
    apiPath?: string;
    /** Optional health check configuration: false or { enabled: false } disables health checks; or custom interval, timeout, retries, path. */
    healthCheck?: HealthCheckConfig;
    /** Path the container healthcheck probes (and Traefik too, unless traefik.healthCheck is set). Defaults to /health. */
    healthCheckPath?: string;
    /** Post-start check through the public proxy URL, run by `flisk up`. See utils/smoke.ts. */
    smoke?: import("../utils/smoke.js").SmokeConfig;
    /** Traefik routing overrides. `healthCheck` is the path Traefik's load balancer probes; defaults to healthCheckPath. */
    traefik?: {
        host?: string;
        pathPrefix?: string;
        healthCheck?: string;
    };
    /** bring-your-own only: false keeps the resource off Traefik (no route, no health check). Defaults to true. */
    exposeViaProxy?: boolean;
    /** bring-your-own only: the app serves a web UI from `/`, so it is routed on `<name>.<project>.localhost` instead of `/api/<name>` (#2997). */
    webUi?: boolean;
    /** On-demand scaling via Sablier (Premium - requires FLISK_LICENSE_KEY). See hasSablierLicense() in extension-fetch.ts. */
    sablier?: {
        enable?: boolean;
        group?: string;
        sessionDuration?: string;
        /** Skip this resource during `flisk up` entirely; a Traefik static route wakes it on first request. Requires enable: true. */
        deferStart?: boolean;
    };
    /** Optional dockerfile path relative to resource dir */
    dockerfile?: string;
    /** Optional Docker image name instead of building from Dockerfile */
    image?: string;
    /** Container runtime options for bring-your-own resources (command, entrypoint, capabilities, ulimits, etc.). */
    container?: ContainerConfig;
    /** agent only: how the agent runtime is scaffolded and where its session state lives. See agent-runtimes/. */
    agent?: AgentConfig;
    /**
     * Run the service as a local process with this shell command instead of a container (no image, no Dockerfile). Started from
     * the service directory with PORT set to `port`. See utils/native-service.ts. For container services, use `container.command`.
     */
    command?: string;
    /** Extra environment for a `command` service. Values may reference `${VAR}` from the project .env or the shell. */
    env?: Record<string, string>;
    /**
     * Non-secret config values for the service's environment, kept literally (no `${VAR}` expansion): a container
     * service gets them through its generated env file, a `command` service in its process env, below `env` on a
     * shared name. `envVars` is the deprecated spelling, read only when `params` is absent.
     */
    params?: Record<string, string>;
    /** Development loop settings (live reload, file watching, test on save). */
    dev?: DevConfig;
}
export interface ResourceConfig extends ResourceConfigFields {
    [key: string]: unknown;
}
