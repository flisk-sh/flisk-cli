// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { dirname, relative, sep } from "node:path";
import type { CheckResult, DiscoveredResource } from "../../types/index.js";
import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { envFileErrors, volumesErrors } from "../service-manifest.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";

/**
 * A bind mount in `volumes` (#1748) is relative to its service directory, and one that climbs out of the project would hand a
 * container files Flisk was never asked to share. The generator refuses it too, after `flisk up` has said yes.
 */
export function checkVolumes(
  projectRoot = findProjectRoot() ?? process.cwd(),
  resources: DiscoveredResource[] = discoverResourcesFromRoot(projectRoot),
): CheckResult {
  const problems = resources.flatMap((resource) => {
    if (!resource.config || !("volumes" in resource.config || "envFile" in resource.config)) {
      return [];
    }
    const dir = relative(projectRoot, dirname(resource.configPath));
    const depth = dir === "" ? 0 : dir.split(sep).length;
    // The shape of each entry is reported with the other service.json fields (checkServiceFields); this check adds the location.
    const config = resource.config as Record<string, unknown>;
    const displayPath = filePath(projectRoot, resource);
    return [
      ...volumesErrors(config, displayPath, depth),
      ...envFileErrors(config, displayPath, depth),
    ].filter((problem) => problem.endsWith("must stay inside the project"));
  });
  if (problems.length === 0) {
    return { name: "Volumes", didPass: true, message: "Every bind mount stays inside the project" };
  }
  return {
    name: "Volumes",
    didPass: false,
    message: `${formatCount(problems.length, "bind mount outside the project", "bind mounts outside the project")}:\n    ${problems.join("\n    ")}`,
    fix: 'Mount a path inside the project, such as "./config", or use a named volume such as "data"',
  };
}
