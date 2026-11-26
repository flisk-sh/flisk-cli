// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { readProjectConfig } from "../../generator/project-config.js";
import type { DiscoveredResource, DoctorAction } from "../../types/index.js";
import { applyDoctorFixes, planDoctorFixes, projectTiltPids } from "../../utils/doctor-fix.js";
import { clearDoctorProbes } from "../../utils/doctor-probe-cache.js";
import { printFixActions } from "../../utils/doctor-render.js";
import { promptConfirm } from "../../utils/prompt.js";
import type { DoctorOptions } from "./context.js";

/**
 * The `--fix` stage: plan the repairs (unused Docker networks, leftover doctor probes),
 * apply them, and print them in text mode. Runs before the checks so the checks report
 * the state after the fix. Returns the actions, or undefined when `--fix` was not requested.
 */
export async function planAndRunDoctorFixes(
  options: DoctorOptions,
  projectRoot: string | null,
  nativeResources: DiscoveredResource[] | null,
): Promise<DoctorAction[] | undefined> {
  let fixActions: DoctorAction[] | undefined;
  if (options.fix && nativeResources) {
    // The repairs are for Docker networks and Tilt probes, which a project of local processes does not have.
    fixActions = [];
  } else if (options.fix) {
    try {
      let projectName: string | undefined;
      if (projectRoot) {
        try {
          projectName = readProjectConfig(projectRoot).project.name;
        } catch {
          // An unreadable config is reported by the project checks below.
        }
      }
      const tiltPids = projectRoot ? projectTiltPids(projectRoot) : [];
      const planned = await planDoctorFixes(projectName, undefined, {
        tiltPids,
        machine: options.scope === "machine",
        projectRoot: projectRoot ?? undefined,
      });
      fixActions = await applyDoctorFixes(planned, {
        dryRun: options.dryRun as boolean,
        confirm:
          options.yes || (!options.json && process.stdin.isTTY)
            ? async (action) =>
                options.yes ||
                (await promptConfirm({
                  message: `Run \`${action.command}\` (${action.check}, ${action.reason})?`,
                }))
            : undefined,
      });
      // The repairs change exactly what the Docker probes measure, so their cached verdicts must not survive it.
      if (!options.dryRun) clearDoctorProbes();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fixActions = [
        {
          id: "plan-fixes",
          check: "Docker networks",
          scope: "project",
          command: "docker network ls",
          status: "failed",
          reason: `could not list Docker networks: ${reason.split(/\r?\n/)[0]}`,
        },
      ];
    }
    if (!options.json && fixActions && fixActions.length > 0) {
      printFixActions(fixActions, options.dryRun as boolean);
    }
  }
  return fixActions;
}
