// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { McpToolResult } from "../../server.js";
import { argSpec, option } from "../../spec-args.js";
import { type RunFlisk, viaCli } from "../run.js";
import { flag } from "../shared.js";

/**
 * The read-only health checks: the running stack's live state (`status`), the host's ability to run the stack
 * (`doctor`) and the installed CLI's bundled runtime assets (`runtime_check`). Each tool's arguments are
 * declared once in an argSpec table bound to the command's generated spec.
 */

/** The `doctor` tool's arguments, bound to the `flisk doctor` spec. */
export const doctorArgs = argSpec(
  ["doctor"],
  [
    "--json",
    option("--problems-only", {
      description:
        "Return only failing checks and summary counts; recommended for agents to reduce payload size",
    }),
    option("--no-ping", {
      arg: "noPing",
      description: "Skip pinging running services' health endpoints",
    }),
  ],
);

/** `flisk doctor --json`, with `--problems-only` for concise diagnostics and `--no-ping` to skip the health endpoints. */
export function buildDoctorArgs(args: Record<string, unknown>): string[] {
  return doctorArgs.build(args);
}

/** The `status` tool's arguments, bound to the `flisk status` spec. */
export const statusArgs = argSpec(
  ["status"],
  [
    "--json",
    option("--unhealthy", {
      description:
        "Only the services that are failing or still starting. The first call after a failed `up`; with every service healthy it returns an empty list, not an error.",
    }),
    option("--stack", { as: "name", description: "Only report the services in this stack" }),
  ],
);

/** `flisk status --json`, narrowed by `unhealthy` and `stack` the way the CLI does. */
export function buildStatusArgs(args: Record<string, unknown>): string[] {
  return statusArgs.build(args);
}

/** The `runtime_check` tool's arguments, bound to the `flisk runtime` spec. */
export const runtimeCheckArgs = argSpec(["runtime"], ["--check-assets", "--json"]);

/** `flisk runtime --check-assets --json`. */
export function buildRuntimeCheckArgs(): string[] {
  return runtimeCheckArgs.build({});
}

/**
 * `flisk status --json --unhealthy` still lists every service (the flag only shortens the text output, and the envelope
 * carries the names in `data.unhealthy`). For an agent that wants the broken services only, drop the others from
 * `data.resources` and from each stack's `resources`, and say so in `data.filteredTo`. Counts keep describing the whole project.
 */
export function trimStatusToUnhealthy(result: McpToolResult): McpToolResult {
  const envelope = result.data as { data?: Record<string, unknown> } | null;
  const data = envelope?.data;
  if (!data || !Array.isArray(data.resources)) return result;
  // A bare Node project reports one resource with a status and no `unhealthy` list: anything not ready is broken.
  const resourceList = data.resources as { name?: string; status?: unknown }[];
  const broken = Array.isArray(data.unhealthy)
    ? new Set(data.unhealthy as string[])
    : data.inferred === true
      ? new Set(resourceList.filter((r) => r.status !== "ready").map((r) => String(r.name)))
      : null;
  if (!broken) return result;
  const trimmed: Record<string, unknown> = {
    ...data,
    resources: (data.resources as { name?: string }[]).filter((r) => broken.has(String(r.name))),
    filteredTo: "unhealthy",
  };
  if (!Array.isArray(data.unhealthy)) trimmed.unhealthy = [...broken];
  if (Array.isArray(data.stacks)) {
    trimmed.stacks = (data.stacks as { resources?: string[] }[]).map((stack) => ({
      ...stack,
      resources: (stack.resources ?? []).filter((name) => broken.has(name)),
    }));
  }
  return { ...result, data: { ...envelope, data: trimmed } };
}

const viaStatusCli = viaCli(buildStatusArgs);

/** The `status` row's handler: the plain `flisk status` run, trimmed to the broken services when `unhealthy` is set. */
export const statusRun =
  (deps: { run: RunFlisk }) =>
  async (args: Record<string, unknown>): Promise<McpToolResult> => {
    const result = await viaStatusCli(deps)(args);
    return flag(args.unhealthy, "unhealthy") ? trimStatusToUnhealthy(result) : result;
  };
