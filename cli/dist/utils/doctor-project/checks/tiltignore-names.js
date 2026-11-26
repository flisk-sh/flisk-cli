// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { normalize, relative } from "node:path";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";
import { isTiltIgnoredName } from "../../validation.js";
/**
 * New resources are rejected by `validateResourceName`, but a project created before that check
 * can still have a folder named `logs`, `dist`, etc. Tilt silently ignores every file under such a
 * folder, so doctor names the affected resources (#5453).
 */
export function checkTiltIgnoredResourceNames() {
    const projectRoot = findProjectRoot() ?? process.cwd();
    const hidden = discoverResourcesFromRoot(projectRoot).filter((resource) => relative(projectRoot, resource.path)
        .split(/[\\/]/)
        .some((part) => isTiltIgnoredName(part)));
    if (hidden.length === 0) {
        return {
            name: "Ignored Names",
            didPass: true,
            message: "No resource paths are hidden by Flisk's generated .tiltignore",
        };
    }
    const list = hidden.map((resource) => normalize(relative(projectRoot, resource.path))).join(", ");
    return {
        name: "Ignored Names",
        didPass: false,
        message: `${formatCount(hidden.length, "resource")} under paths Tilt ignores: ${list}. Tilt will not watch their files`,
        fix: "Rename each resource or stack folder so no path component matches Flisk's .tiltignore, then run: flisk config regenerate",
    };
}
