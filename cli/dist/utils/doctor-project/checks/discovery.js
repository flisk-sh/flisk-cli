// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { normalize, relative } from "node:path";
import { isPathDiscovered, readDiscoveryPaths } from "../../discovery-paths.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";
/**
 * Tilt only builds resources under `discovery.paths`, but the CLI finds every service.json,
 * so a resource outside them is listed and given a URL by `flisk up` yet never started.
 */
export function checkResourceDiscovery() {
    const projectRoot = findProjectRoot() ?? process.cwd();
    const patterns = readDiscoveryPaths(projectRoot);
    const stranded = discoverResourcesFromRoot(projectRoot).filter((resource) => !isPathDiscovered(projectRoot, resource.path, patterns));
    if (stranded.length === 0) {
        return {
            name: "Resource Discovery",
            didPass: true,
            message: `All resources are covered by discovery.paths ${JSON.stringify(patterns)}`,
        };
    }
    const list = stranded
        .map((resource) => normalize(relative(projectRoot, resource.path)))
        .join(", ");
    return {
        name: "Resource Discovery",
        didPass: false,
        message: `${formatCount(stranded.length, "resource")} outside discovery.paths ${JSON.stringify(patterns)}: ${list}. \`flisk up\` will not start them`,
        fix: "Move each under services/<stack>/<name>, or add a matching pattern to discovery.paths in .flisk/project.json and run: flisk config regenerate",
    };
}
