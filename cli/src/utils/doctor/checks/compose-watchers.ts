// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { CheckResult } from "../../../types/index.js";
import type { OrphanedEventsWatcher } from "../../compose-events-watchers.js";
import {
  findOrphanedComposeEventsWatchers,
  scanComposeEventsWatchers,
} from "../../compose-events-watchers.js";

/**
 * Doctor's visibility into the watcher leak: Flisk `docker compose ... events --json` streams still alive after
 * their stack went down or their project directory was deleted. Always a warning, never a failure;
 * `flisk doctor --fix` removes them.
 */
export function checkComposeEventWatchers(
  orphans: OrphanedEventsWatcher[] | null = findOrphanedComposeEventsWatchers(
    scanComposeEventsWatchers(),
  ),
): CheckResult {
  if (orphans === null) {
    return {
      name: "Compose event watchers",
      didPass: true,
      isSkipped: true,
      message: "Could not read the process table or ask Docker",
    };
  }
  if (orphans.length === 0) {
    return {
      name: "Compose event watchers",
      didPass: true,
      message: "No orphaned Compose event watchers",
    };
  }
  const projects = [...new Set(orphans.map((orphan) => orphan.projectName).filter(Boolean))];
  const named = projects.length > 0 ? `: ${projects.join(", ")}` : "";
  return {
    name: "Compose event watchers",
    didPass: false,
    isWarning: true,
    message: `${orphans.length} orphaned "docker compose events" watcher process(es) left behind by stopped or deleted Flisk projects${named}`,
    fix: "Stop them with: flisk doctor --fix --scope=machine",
  };
}
