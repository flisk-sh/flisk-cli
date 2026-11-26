// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { relative } from "node:path";
import { BRING_YOUR_OWN_TYPE } from "../../constants.js";
import { formatCount } from "../../formatting.js";
import { isNativeService } from "../../native-service.js";
import { findProjectRoot } from "../../paths.js";
import { isApiServiceType } from "../../resource-kind.js";
import { discoverResourcesFromRoot } from "../../services.js";
/**
 * Two resources with one appName share a Compose service name and Traefik router and service names
 * (all built from the name, none from the directory), so one of them is lost or misrouted.
 */
export function checkDuplicateResourceNames(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const byName = new Map();
    for (const resource of resources) {
        const paths = byName.get(resource.name) ?? [];
        paths.push(relative(projectRoot, resource.configPath) || resource.configPath);
        byName.set(resource.name, paths);
    }
    const duplicates = [...byName].filter(([, paths]) => paths.length > 1);
    if (duplicates.length === 0) {
        return {
            name: "Duplicate resource names",
            didPass: true,
            message: "Every resource has a unique appName",
        };
    }
    const lines = duplicates.map(([name, paths]) => `"${name}" in ${paths.join(" and ")}`);
    return {
        name: "Duplicate resource names",
        didPass: false,
        message: `${formatCount(duplicates.length, "appName")} used by more than one resource:\n    ${lines.join("\n    ")}`,
        fix: 'Give each resource its own "appName" in its service.json. The name becomes the Compose service and the Traefik router, so two resources with one name collide',
    };
}
/** A resource that gets a Traefik route to its own `port`: a backend, an mcp server, an agent, or a bring-your-own resource that is not opted out. */
function isRoutedToPort(resource) {
    const appType = resource.config?.appType;
    if (isApiServiceType(appType))
        return true;
    return appType === BRING_YOUR_OWN_TYPE && resource.config?.exposeViaProxy !== false;
}
/**
 * Two routed resources on one `port`. This is a warning, not a failure: the engine publishes no service
 * port on the host and gives each resource its own container, which Traefik reaches as <container>:<port>,
 * so two containers can listen on 4000 at once. The pair still confuses the checks and URLs that identify
 * a backend by its port, and usually means a copied service.json.
 */
export function checkDuplicateResourcePorts(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const byPort = new Map();
    for (const resource of resources) {
        const port = resource.config?.port;
        // A bring-your-own port is the port inside its own container, so two Postgres images on 5432 do not collide.
        // A local-process service binds its own host port whatever its type, so a frontend counts here too.
        if (typeof port !== "number" || !(isRoutedToPort(resource) || isNativeService(resource))) {
            continue;
        }
        if (resource.config?.appType === BRING_YOUR_OWN_TYPE)
            continue;
        const items = byPort.get(port) ?? [];
        items.push(resource);
        byPort.set(port, items);
    }
    // A container frontend is not routed to its port, so it only collides with another local-process service.
    const shared = [...byPort].filter(([, items]) => items.filter(isRoutedToPort).length > 1 || items.filter(isNativeService).length > 1);
    if (shared.length === 0) {
        return {
            name: "Duplicate resource ports",
            didPass: true,
            message: "No two routed resources use the same port",
        };
    }
    const lines = shared.map(([port, items]) => `port ${port}: ${items.map((r) => r.name).join(", ")}`);
    const hasLocalCollision = shared.some(([, items]) => items.filter(isNativeService).length > 1);
    if (hasLocalCollision) {
        return {
            name: "Duplicate resource ports",
            didPass: false,
            isWarning: false,
            message: `${formatCount(shared.length, "port")} used by more than one routed resource:\n    ${lines.join("\n    ")}`,
            fix: 'Two local-process services cannot bind the same host port. Give each service a distinct "port" value in its service.json (flisk resource assigns free ones)',
        };
    }
    return {
        name: "Duplicate resource ports",
        didPass: false,
        isWarning: true,
        message: `${formatCount(shared.length, "port")} used by more than one routed resource:\n    ${lines.join("\n    ")}`,
        fix: 'Usually a copied service.json. Each container can listen on the same port, but pick distinct "port" values (flisk resource assigns free ones) so URLs like http://<resource>:<port> and localhost checks stay unambiguous',
    };
}
