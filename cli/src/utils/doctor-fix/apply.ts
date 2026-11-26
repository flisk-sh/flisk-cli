// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { DoctorAction } from "../../types/index.js";
import { type DoctorFixDeps, dockerFixDeps } from "./deps.js";

function firstLine(error: unknown): string {
  const stderr = String((error as { stderr?: Buffer | string }).stderr ?? error).trim();
  return stderr.split(/\r?\n/)[0] ?? "";
}

export interface ApplyOptions {
  dryRun: boolean;
  /** Ask before each destructive action; resolves false to decline. Absent means confirmation is unavailable. */
  confirm?: (action: DoctorAction) => Promise<boolean>;
}

/** Run the planned actions in order. A declined or failed action never stops the rest, so a re-run converges. */
export async function applyDoctorFixes(
  actions: DoctorAction[],
  options: ApplyOptions,
  deps: DoctorFixDeps = dockerFixDeps,
): Promise<DoctorAction[]> {
  const results: DoctorAction[] = [];
  for (const action of actions) {
    if (action.status !== "planned" || options.dryRun) {
      results.push(action);
      continue;
    }
    if (!options.confirm) {
      results.push({
        ...action,
        status: "skipped",
        reason: "confirmation required; run in a terminal or pass --yes",
      });
      continue;
    }
    let confirmed = false;
    try {
      confirmed = await options.confirm(action);
    } catch {
      // No terminal to ask on.
    }
    if (!confirmed) {
      results.push({ ...action, status: "skipped", reason: "not confirmed" });
      continue;
    }
    try {
      if (action.id === "trim:colima") {
        await deps.trimColima();
        results.push({ ...action, status: "applied", reason: "trimmed" });
        continue;
      }
      if (action.id.startsWith("prune:")) {
        await deps.prune(action.id === "prune:builder" ? "builder" : "images");
        results.push({ ...action, status: "applied", reason: "pruned" });
        continue;
      }
      if (action.id.startsWith("colima:")) {
        const what = action.id.slice("colima:".length);
        if (what === "start" || what === "restart") {
          await deps.colima(what);
          results.push({ ...action, status: "applied", reason: `colima ${what} ran` });
          continue;
        }
        try {
          await deps.colima("native-lima");
          results.push({
            ...action,
            status: "applied",
            reason: "native lima repaired and colima started",
          });
        } catch (error) {
          results.push({ ...action, status: "failed", reason: firstLine(error) });
        }
        continue;
      }
      if (action.id.startsWith("stop-tilt:")) {
        deps.stopProcess(Number(action.id.slice("stop-tilt:".length)));
        results.push({ ...action, status: "applied", reason: "stopped" });
        continue;
      }
      if (action.id.startsWith("stop-compose-events:")) {
        // `stop-compose-events:<pid>:<identity>`: the identity pins the repair to the stream that was planned.
        const [pid, identity] = action.id.slice("stop-compose-events:".length).split(":");
        if (deps.stopComposeWatcher) await deps.stopComposeWatcher(Number(pid), identity);
        else deps.stopProcess(Number(pid));
        results.push({ ...action, status: "applied", reason: "stopped" });
        continue;
      }
      await deps.removeNetwork(action.id.slice("remove-network:".length));
      results.push({ ...action, status: "applied", reason: "removed" });
    } catch (error) {
      results.push({ ...action, status: "failed", reason: firstLine(error) });
    }
  }
  return results;
}

/** Whether any action leaves a problem behind that a re-run could still repair. */
export function hasFailedActions(actions: DoctorAction[]): boolean {
  return actions.some((action) => action.status === "failed");
}
