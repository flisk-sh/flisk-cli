// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { relative } from "node:path";
import type { DiscoveredResource } from "../../types/index.js";

export function filePath(projectRoot: string, resource: DiscoveredResource): string {
  return relative(projectRoot, resource.configPath) || resource.configPath;
}
