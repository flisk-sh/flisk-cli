// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { toComposeProjectName } from "./compose-project-name.js";

type CommandRunner = (command: string, args: string[]) => string;

const run: CommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: "utf-8", stdio: "pipe", windowsHide: true });

/** Network names the engine creates per project (see engine/.../docker/constants.star and init-networks). */
const PROJECT_NETWORK_SUFFIXES = [
  "traefik-public",
  "traefik-private",
  "backend",
  "database",
  "infisical-network",
  "verdaccio-network",
  "proxy",
];

/** The engine prefixes networks with the project name, hyphens turned into underscores. */
export function projectNetworkNames(projectName: string): string[] {
  const prefix = toComposeProjectName(projectName);
  return PROJECT_NETWORK_SUFFIXES.map((suffix) => `${prefix}_${suffix}`);
}

/**
 * Prefixes of Flisk projects among `networkNames`, from the networks the engine creates. Generic suffixes such as
 * `backend` also occur in non-Flisk compose projects, so a prefix counts only if it has a Traefik network, which
 * only Flisk creates.
 */
export function fliskNetworkPrefixes(networkNames: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const name of networkNames) {
    for (const marker of ["traefik-public", "traefik-private"]) {
      if (name.endsWith(`_${marker}`)) prefixes.add(name.slice(0, -(marker.length + 1)));
    }
  }
  return prefixes;
}

/** The Flisk project prefix a network belongs to (`umami` for `umami_backend`), or null. */
export function fliskNetworkOwner(name: string, prefixes: Set<string>): string | null {
  for (const suffix of PROJECT_NETWORK_SUFFIXES) {
    if (name.endsWith(`_${suffix}`)) {
      const prefix = name.slice(0, -(suffix.length + 1));
      if (prefixes.has(prefix)) return prefix;
    }
  }
  return null;
}

export interface PruneNetworksResult {
  removed: string[];
  /** Networks that exist but Docker refused to remove, usually because a container is still attached. */
  kept: { name: string; reason: string }[];
}

export function parseNetworkNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The names from `docker network ls`, for callers that already listed networks before pruning (#4173). */
export function listProjectNetworks(commandRunner: CommandRunner = run): string[] {
  return parseNetworkNames(commandRunner("docker", ["network", "ls", "--format", "{{.Name}}"]));
}

/**
 * Remove this project's own networks. Only the exact names the engine creates are touched, and `docker network rm`
 * itself refuses a network that still has containers attached, so another project's networks and in-use networks
 * are never removed. `existingNetworks` reuses a list read earlier on the idle path, avoiding a second network ls.
 */
export function pruneProjectNetworks(
  projectName: string,
  commandRunner: CommandRunner = run,
  existingNetworks?: readonly string[],
): PruneNetworksResult {
  const existing = new Set(existingNetworks ?? listProjectNetworks(commandRunner));
  const result: PruneNetworksResult = { removed: [], kept: [] };
  for (const name of projectNetworkNames(projectName)) {
    if (!existing.has(name)) continue;
    try {
      commandRunner("docker", ["network", "rm", name]);
      result.removed.push(name);
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer | string }).stderr ?? err).trim();
      result.kept.push({ name, reason: stderr.split(/\r?\n/)[0] ?? "" });
    }
  }
  return result;
}

export interface PruneNetworksPlan {
  /** Networks `--prune-networks` would remove: they exist and no container outside the stopped stacks is attached. */
  remove: string[];
  /** Networks it would leave in place, with the reason (another container is attached, or Docker could not list them). */
  keep: { name: string; reason: string }[];
}

/**
 * What {@link pruneProjectNetworks} would do, without removing anything: the same exact project network names, each
 * checked with `docker ps --filter network=<name>` for running attached containers (the reason `docker network rm`
 * refuses one). `down` stops before it prunes, so containers of the compose projects in `stoppedByDown` (this project's
 * stacks, from {@link projectComposeProjects}) do not count: they will be gone by the time the network is removed.
 */
export function planProjectNetworkPrune(
  projectName: string,
  commandRunner: CommandRunner = run,
  stoppedByDown: readonly string[] = [],
): PruneNetworksPlan {
  const existing = new Set(listProjectNetworks(commandRunner));
  const stopped = new Set(stoppedByDown);
  const plan: PruneNetworksPlan = { remove: [], keep: [] };
  for (const name of projectNetworkNames(projectName)) {
    if (!existing.has(name)) continue;
    let composeProjects: string[];
    try {
      composeProjects = commandRunner("docker", [
        "ps",
        "--filter",
        `network=${name}`,
        "--format",
        // The `c:` prefix keeps a line for a container without a compose label (an empty label is not "no container").
        'c:{{.Label "com.docker.compose.project"}}',
      ])
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("c:"))
        .map((line) => line.slice(2));
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer | string }).stderr ?? err).trim();
      plan.keep.push({ name, reason: stderr.split(/\r?\n/)[0] ?? "" });
      continue;
    }
    const remaining = composeProjects.filter((project) => !project || !stopped.has(project)).length;
    if (remaining > 0) {
      plan.keep.push({
        name,
        reason: `${remaining} container${remaining === 1 ? " is" : "s are"} attached`,
      });
    } else {
      plan.remove.push(name);
    }
  }
  return plan;
}
