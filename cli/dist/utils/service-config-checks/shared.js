// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { relative } from "node:path";
export function filePath(projectRoot, resource) {
    return relative(projectRoot, resource.configPath) || resource.configPath;
}
