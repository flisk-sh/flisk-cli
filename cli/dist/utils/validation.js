// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { OPTIONAL_INFRA_SERVICES } from "./constants.js";
import { trimChars, trimEndChars } from "./trim-chars.js";
// Starts and ends with a letter or digit: "-x" and "--json" (an option swallowed as a value) are not names.
export const KEBAB_CASE_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isKebabCase(value) {
    return KEBAB_CASE_REGEX.test(value);
}
// Names Windows keeps for devices: a folder called con or com1 cannot be created there.
export const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
// A resource or stack name becomes a container hostname, and a DNS label is at most 63 characters.
export const MAX_NAME_LENGTH = 63;
const KEBAB_RULE = "Use lowercase letters, numbers, and hyphens only";
/**
 * Fixed Tilt/Compose names Flisk registers for its own stack. A resource with one of these names collides with the stack
 * later in `flisk up` (the traceback from `docker_compose(...)` in apply_compose_resource_registration.star is what #3840
 * saw). Sources: CORE_INFRA/INFRA_RESOURCES in runtime/discovery/config.star and the dc_resource/local_resource names in
 * runtime/engine/topologies/tilt/resources/infra-loader.star.
 */
export const RESERVED_INFRASTRUCTURE_NAMES = [
    "clickhouse",
    "database-management",
    "dashy",
    "debezium",
    "debezium-connect",
    "elk",
    "enhanced-connector-setup",
    "golden-layers-build",
    "infisical",
    "infisical-db",
    "infisical-redis",
    "init-networks",
    "kafka",
    "kibana",
    "logstash",
    "main-redirect",
    "monitoring",
    "nats",
    "nats-http-bridge",
    "postgres",
    "postgres-healthy",
    "proxy",
    "redis",
    "sablier",
    "signoz-frontend",
    "signoz-otel-collector",
    "signoz-query-service",
    "skywalking-oap",
    "skywalking-ui",
    "tilt",
    "tilt-proxy",
    "traefik",
    "traefik-pages",
    "verdaccio",
    "wake-gateway",
    "zookeeper",
];
/** True when `name` is fixed infrastructure, not a name a user resource may take. */
export function isReservedInfrastructureName(name) {
    return includes(RESERVED_INFRASTRUCTURE_NAMES, name);
}
/**
 * Names Flisk itself uses for its own areas that are not Tilt/Compose service names, so they are not in
 * RESERVED_INFRASTRUCTURE_NAMES: `services/platform/` is the folder holding the generated infrastructure
 * Compose files, and `golden-image` is a platform feature name (see PROJECT_FEATURES) that can appear in
 * `enabledStacks`. A user stack with one of these names would be listed by `flisk stacks` as an ordinary
 * stack and make the name in `enabledStacks` ambiguous (#5345). Stack names only: a resource called
 * "platform" lives under its own stack folder and does not collide with `services/platform/`.
 */
export const RESERVED_STACK_ONLY_NAMES = ["golden-image", "platform"];
/** True when `name` is reserved for Flisk's own areas and may not be a user stack name. */
export function isReservedStackName(name) {
    return isReservedInfrastructureName(name) || includes(RESERVED_STACK_ONLY_NAMES, name);
}
/**
 * Valid kebab-case directory names covered by `cli/templates/.tiltignore.hbs` catch-all rules. A
 * service or stack folder with one of these names is ignored by Tilt's file watcher, so edits under
 * it never trigger a rebuild (#5453). Dot/underscore patterns in the template cannot be resource
 * names anyway and are omitted.
 */
export const TILTIGNORE_RESERVED_NAMES = [
    "build",
    "coverage",
    "dist",
    "docker",
    "logs",
    "out",
    "playwright-report",
    "postgres-data",
    "redis-data",
    "temp",
    "test-results",
    "tmp",
    "verdaccio-conf",
    "verdaccio-plugins",
    "verdaccio-storage",
];
/** True when Tilt's generated `.tiltignore` hides a directory with this name from file watching. */
export function isTiltIgnoredName(name) {
    return includes(TILTIGNORE_RESERVED_NAMES, name);
}
function tiltIgnoredMessage(label, name) {
    return `${label} "${name}" is not valid: Tilt ignores any folder named ${name}, so its files would not trigger rebuilds. Pick another name.`;
}
function invalidNameMessage(label, value) {
    const example = label === "Resource name" ? "my-service" : label === "Stack name" ? "my-stack" : "my-project";
    return `${label} "${value}" is not valid. ${KEBAB_RULE}, e.g. "${example}".`;
}
function tooLongMessage(label, value) {
    return `${label} "${value.slice(0, 20)}..." is ${value.length} characters; the limit is ${MAX_NAME_LENGTH} (it becomes a container hostname).`;
}
function windowsReservedMessage(label, value) {
    return `${label} "${value}" is not valid: Windows reserves it for a device (con, prn, aux, nul, com1-com9, lpt1-lpt9), so the folder cannot exist there. Pick another name, e.g. "console".`;
}
function validateName(label, name, folderOnDisk) {
    const error = !name.trim()
        ? `${label} is required`
        : !isKebabCase(name)
            ? invalidNameMessage(label, name)
            : folderOnDisk && WINDOWS_RESERVED.test(name)
                ? windowsReservedMessage(label, name)
                : name.length > MAX_NAME_LENGTH
                    ? tooLongMessage(label, name)
                    : undefined;
    return error === undefined ? { valid: true } : { valid: false, error };
}
// A resource and a stack name become folders, so Windows device names are refused; a project name has its own check.
export function validateResourceName(name) {
    const result = validateName("Resource name", name, true);
    if (result.valid && isReservedInfrastructureName(name)) {
        return {
            valid: false,
            error: `Resource name "${name}" is reserved for Flisk's own infrastructure: Flisk registers a fixed Tilt/Compose service with that name. Pick another name.`,
        };
    }
    if (result.valid && isTiltIgnoredName(name)) {
        return { valid: false, error: tiltIgnoredMessage("Resource name", name) };
    }
    return result;
}
export function validateStackName(name) {
    const result = validateName("Stack name", name, true);
    if (!result.valid)
        return result;
    if (isReservedStackName(name)) {
        return {
            valid: false,
            error: `Stack name "${name}" is reserved for Flisk's own infrastructure. Pick another name.`,
        };
    }
    if (result.valid && isTiltIgnoredName(name)) {
        return { valid: false, error: tiltIgnoredMessage("Stack name", name) };
    }
    // A linked worktree's database is `<project>_<stack>_<8-hex checkout id>`; a stack ending in 8 hex digits would make
    // that name ambiguous with another checkout's (#4698).
    if (/-[0-9a-f]{8}$/.test(name)) {
        return {
            valid: false,
            error: `Stack name "${name}" cannot end with an 8-character hex segment (for example -deadbeef): it would be confused with a git worktree's database suffix.`,
        };
    }
    return result;
}
export function validateProjectName(name) {
    return validateName("Project name", name, false);
}
/** Canonicalizes a project root so symlink aliases derive the same fallback name. */
function canonicalProjectRoot(projectRoot) {
    const resolved = resolve(projectRoot);
    try {
        return realpathSync(resolved);
    }
    catch {
        return resolved;
    }
}
/**
 * Derive a Docker- and npm-compatible project name from a folder name.
 * Lowercase, spaces and dots become `-`, anything else is stripped.
 *
 * When the folder has no ASCII letters or digits, a stable hash of the absolute
 * project root gives it a unique name instead of a shared `my-project` collision.
 * A digit-leading slug is prefixed with `p-` because the name becomes an
 * unquoted Postgres role and database name (#5418).
 */
export function deriveProjectName(folderName, projectRoot = folderName) {
    let name = trimChars(folderName
        .toLowerCase()
        .replace(/[ .]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-"), "-");
    if (!name) {
        const hash = createHash("sha256")
            .update(canonicalProjectRoot(projectRoot))
            .digest("hex")
            .slice(0, 8);
        return `project-${hash}`;
    }
    if (/^[0-9]/.test(name))
        name = `p-${name}`;
    if (name.length > MAX_NAME_LENGTH) {
        name = trimEndChars(name.slice(0, MAX_NAME_LENGTH), "-");
    }
    return name;
}
export function createKebabCaseValidator(context) {
    const validate = context === "resource" ? validateResourceName : validateStackName;
    return (input) => {
        const result = validate(input);
        return result.valid ? true : (result.error ?? "Invalid name");
    };
}
export function validateOptionalInfraService(service) {
    if (includes(OPTIONAL_INFRA_SERVICES, service)) {
        return { valid: true };
    }
    return {
        valid: false,
        error: `Invalid service. Must be one of: ${OPTIONAL_INFRA_SERVICES.join(", ")}`,
    };
}
/**
 * Validate that a port is a valid TCP/UDP port number (1-65535).
 * Accepts either a number or a string representation without leading zeros.
 */
export function isValidPort(port) {
    if (typeof port === "number") {
        return Number.isInteger(port) && port >= 1 && port <= 65535;
    }
    if (typeof port === "string") {
        return /^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535;
    }
    return false;
}
/**
 * Check a filesystem path segment for characters that are unsafe to use in a
 * path (null bytes, or characters that are invalid on common filesystems).
 * Does not check for path traversal (`..`) - callers that resolve the path
 * against a base directory should check that separately.
 */
export function isPathSafe(path) {
    return !path.includes("\0") && !/[<>:"|?*]/.test(path);
}
/**
 * Like {@link isPathSafe}, for a destination directory that may be absolute: a Windows drive prefix (`D:\` or `D:/`) is
 * allowed, because its colon is not a special character. Any other colon, and every other reserved character, is still
 * refused. Without this `flisk demo --project D:\...` failed with "Invalid path" on a Windows runner. Use isPathSafe, not
 * this, for paths that must stay inside the project (resource paths).
 */
export function isTargetDirSafe(path) {
    return isPathSafe(path.replace(/^[A-Za-z]:(?=[\\/])/, ""));
}
export function sanitizeForShell(value, replacement = "_") {
    return value.replace(/[^a-zA-Z0-9-]/g, replacement).substring(0, 100);
}
export function includes(array, value) {
    return array.includes(value);
}
