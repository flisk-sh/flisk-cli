// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { declaresCommand } from "./native-service.js";
/**
 * `appName` and `stack` end up in a Docker image name (`<project>_<stack>_<appName>:dev`), a Compose service and a container
 * name. Docker refuses a repository name with an uppercase letter, a space or a leading, trailing or doubled separator, and
 * Tilt then fails inside `docker_compose` after `flisk up` said all was well. 63 is the DNS label limit the Traefik host uses.
 */
const DOCKER_NAME = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
/** Tilt labels every service `app.<appName>`, and a label is at most 63 bytes; a stack has no such prefix. */
const DOCKER_NAME_MAX = { appName: 59, stack: 63 };
export function isDockerSafeName(value, max = DOCKER_NAME_MAX.stack) {
    return typeof value === "string" && value.length <= max && DOCKER_NAME.test(value);
}
/** Errors for an `appName` or `stack` that Docker cannot name an image after. A `command` service never reaches Docker. */
export function dockerNameErrors(manifest, displayPath) {
    if (declaresCommand(manifest))
        return [];
    const errors = [];
    for (const field of ["appName", "stack"]) {
        const value = manifest[field];
        if (typeof value !== "string" || isDockerSafeName(value, DOCKER_NAME_MAX[field]))
            continue;
        // The value is not echoed: it may hold the line break that makes a service.json dangerous (see lineBreakErrors).
        errors.push(`${displayPath}.${field}: cannot be a Docker image name; use lowercase letters and digits joined by "-", "_" or "." (at most ${DOCKER_NAME_MAX[field]} characters)`);
    }
    return errors;
}
