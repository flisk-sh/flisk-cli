// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { basename, dirname } from "node:path";
import { BRING_YOUR_OWN_TYPE } from "../../constants.js";
import { findProjectRoot } from "../../paths.js";
import { isApiServiceType } from "../../resource-kind.js";
import { resolveServicePath, routesAsApi } from "../../service-urls.js";
import { discoverResourcesFromRoot } from "../../services.js";
import { trimEndChars } from "../../trim-chars.js";
/**
 * Two API backends in one stack used to share the stack-scoped Traefik routers (`/api/<stack>-management`), so the same rule
 * matched both and Traefik chose between them arbitrarily. The engine now counts the routable backends of a stack inside one
 * service directory (the same grouping as here: resources in one directory that name the same stack). When there are two or more,
 * it drops the stack routers for all of them. A backend that sets its own `traefik.host` / `traefik.pathPrefix` keeps a router
 * for just that route; the others are left with `/api/<name>` only. This check warns about the backends that lose the stack path
 * and about two backends that set the same explicit route.
 *
 * It also warns, across the whole project, when two services resolve to one API path: `orders` and `orders-api` both get
 * `/api/orders` (the `-api` suffix is dropped), as do two services with the same `apiPath`. Their `-project` routers then carry the
 * same rule and priority, so Traefik sends every request to one of them and `flisk up` prints the same URL for both.
 */
export function checkSharedStackRoutes(projectRoot = findProjectRoot() ?? process.cwd()) {
    const groups = new Map();
    const discovered = discoverResourcesFromRoot(projectRoot);
    for (const resource of discovered) {
        const config = resource.config;
        const routable = isApiServiceType(config?.appType) ||
            // A web UI has its own host name and no stack-scoped router (#2997), so it cannot share a route with the stack's backends.
            (config?.appType === BRING_YOUR_OWN_TYPE &&
                config.exposeViaProxy !== false &&
                config.webUi !== true);
        if (!routable)
            continue;
        const directory = dirname(resource.path);
        const stack = config?.stack ?? basename(directory);
        const key = `${directory}\0${stack}`;
        const group = groups.get(key) ?? { stack, resources: [] };
        group.resources.push(resource);
        groups.set(key, group);
    }
    const problems = [];
    for (const { stack, resources } of groups.values()) {
        if (resources.length < 2)
            continue;
        const explicit = (resource) => Boolean(resource.config?.traefik?.host || resource.config?.traefik?.pathPrefix);
        // A bring-your-own service (an imported Compose app) never had the stack-management route: it is reached at
        // /api/<name>, which it keeps, so "losing" a route it never used only confused a first run of an imported stack.
        const lost = resources
            .filter((resource) => !explicit(resource) && resource.config?.appType !== BRING_YOUR_OWN_TYPE)
            .map((r) => r.name);
        if (lost.length > 0) {
            problems.push(`stack "${stack}": ${lost.sort((left, right) => left.localeCompare(right)).join(", ")} lose the shared /api/${stack}-management route because ${resources.length} backends share the stack; they are routed at /api/<name> only`);
        }
        for (const field of ["host", "pathPrefix"]) {
            const byValue = new Map();
            for (const resource of resources) {
                const value = resource.config?.traefik?.[field];
                if (value)
                    byValue.set(value, [...(byValue.get(value) ?? []), resource.name]);
            }
            for (const [value, names] of byValue) {
                if (names.length > 1) {
                    problems.push(`stack "${stack}": ${names.sort((left, right) => left.localeCompare(right)).join(" and ")} both set traefik.${field} "${value}", so Traefik cannot tell them apart`);
                }
            }
        }
    }
    problems.push(...apiPathCollisions(discovered));
    if (problems.length === 0) {
        return {
            name: "Stack API routes",
            didPass: true,
            message: "No two backends in one service directory compete for one stack route",
        };
    }
    return {
        name: "Stack API routes",
        didPass: false,
        isWarning: true,
        message: problems.join("\n    "),
        fix: 'Call each backend at /api/<name>, move one backend to its own stack, or give each its own "traefik.pathPrefix" in service.json; for two services on one API path, rename one or give it its own "apiPath"',
    };
}
/** Services that `flisk up` routes at the same API path (the engine's cli_api_path in traefik_helpers.star), one message per path. */
function apiPathCollisions(resources) {
    const byPath = new Map();
    for (const resource of resources) {
        if (!routesAsApi(resource))
            continue;
        // `/api/x/` and `/api/x` match the same requests (`/api/x/...`), so they collide too.
        const path = trimEndChars(resolveServicePath(resource), "/") || "/";
        byPath.set(path, [...(byPath.get(path) ?? []), resource.name]);
    }
    const problems = [];
    for (const [path, names] of byPath) {
        if (names.length < 2)
            continue;
        problems.push(`${names.sort((left, right) => left.localeCompare(right)).join(" and ")} are ${names.length === 2 ? "both" : "all"} routed at ${path} on the API host, so Traefik sends every request for ${path} to one of them and the ${names.length === 2 ? "other cannot" : "others cannot"} be reached`);
    }
    return problems;
}
