import type { ValidationResult } from "../types/index.js";
export declare const KEBAB_CASE_REGEX: RegExp;
export declare const WINDOWS_RESERVED: RegExp;
export declare const MAX_NAME_LENGTH = 63;
/**
 * Fixed Tilt/Compose names Flisk registers for its own stack. A resource with one of these names collides with the stack
 * later in `flisk up` (the traceback from `docker_compose(...)` in apply_compose_resource_registration.star is what #3840
 * saw). Sources: CORE_INFRA/INFRA_RESOURCES in runtime/discovery/config.star and the dc_resource/local_resource names in
 * runtime/engine/topologies/tilt/resources/infra-loader.star.
 */
export declare const RESERVED_INFRASTRUCTURE_NAMES: readonly ["clickhouse", "database-management", "dashy", "debezium", "debezium-connect", "elk", "enhanced-connector-setup", "golden-layers-build", "infisical", "infisical-db", "infisical-redis", "init-networks", "kafka", "kibana", "logstash", "main-redirect", "monitoring", "nats", "nats-http-bridge", "postgres", "postgres-healthy", "proxy", "redis", "sablier", "signoz-frontend", "signoz-otel-collector", "signoz-query-service", "skywalking-oap", "skywalking-ui", "tilt", "tilt-proxy", "traefik", "traefik-pages", "verdaccio", "wake-gateway", "zookeeper"];
/** True when `name` is fixed infrastructure, not a name a user resource may take. */
export declare function isReservedInfrastructureName(name: string): boolean;
/**
 * Names Flisk itself uses for its own areas that are not Tilt/Compose service names, so they are not in
 * RESERVED_INFRASTRUCTURE_NAMES: `services/platform/` is the folder holding the generated infrastructure
 * Compose files, and `golden-image` is a platform feature name (see PROJECT_FEATURES) that can appear in
 * `enabledStacks`. A user stack with one of these names would be listed by `flisk stacks` as an ordinary
 * stack and make the name in `enabledStacks` ambiguous (#5345). Stack names only: a resource called
 * "platform" lives under its own stack folder and does not collide with `services/platform/`.
 */
export declare const RESERVED_STACK_ONLY_NAMES: readonly ["golden-image", "platform"];
/** True when `name` is reserved for Flisk's own areas and may not be a user stack name. */
export declare function isReservedStackName(name: string): boolean;
/**
 * Valid kebab-case directory names covered by `cli/templates/.tiltignore.hbs` catch-all rules. A
 * service or stack folder with one of these names is ignored by Tilt's file watcher, so edits under
 * it never trigger a rebuild (#5453). Dot/underscore patterns in the template cannot be resource
 * names anyway and are omitted.
 */
export declare const TILTIGNORE_RESERVED_NAMES: readonly ["build", "coverage", "dist", "docker", "logs", "out", "playwright-report", "postgres-data", "redis-data", "temp", "test-results", "tmp", "verdaccio-conf", "verdaccio-plugins", "verdaccio-storage"];
/** True when Tilt's generated `.tiltignore` hides a directory with this name from file watching. */
export declare function isTiltIgnoredName(name: string): boolean;
export declare function validateResourceName(name: string): ValidationResult;
export declare function validateStackName(name: string): ValidationResult;
export declare function validateProjectName(name: string): ValidationResult;
/**
 * Derive a Docker- and npm-compatible project name from a folder name.
 * Lowercase, spaces and dots become `-`, anything else is stripped.
 *
 * When the folder has no ASCII letters or digits, a stable hash of the absolute
 * project root gives it a unique name instead of a shared `my-project` collision.
 * A digit-leading slug is prefixed with `p-` because the name becomes an
 * unquoted Postgres role and database name (#5418).
 */
export declare function deriveProjectName(folderName: string, projectRoot?: string): string;
export declare function createKebabCaseValidator(context: "resource" | "stack"): (input: string) => true | string;
export declare function validateOptionalInfraService(service: string): ValidationResult;
/**
 * Validate that a port is a valid TCP/UDP port number (1-65535).
 * Accepts either a number or a string representation without leading zeros.
 */
export declare function isValidPort(port: number | string): boolean;
/**
 * Check a filesystem path segment for characters that are unsafe to use in a
 * path (null bytes, or characters that are invalid on common filesystems).
 * Does not check for path traversal (`..`) - callers that resolve the path
 * against a base directory should check that separately.
 */
export declare function isPathSafe(path: string): boolean;
/**
 * Like {@link isPathSafe}, for a destination directory that may be absolute: a Windows drive prefix (`D:\` or `D:/`) is
 * allowed, because its colon is not a special character. Any other colon, and every other reserved character, is still
 * refused. Without this `flisk demo --project D:\...` failed with "Invalid path" on a Windows runner. Use isPathSafe, not
 * this, for paths that must stay inside the project (resource paths).
 */
export declare function isTargetDirSafe(path: string): boolean;
export declare function sanitizeForShell(value: string, replacement?: string): string;
export declare function includes<T extends readonly string[]>(array: T, value: string): value is T[number];
