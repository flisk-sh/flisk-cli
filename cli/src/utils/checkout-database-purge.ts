// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process";
import { toComposeProjectName } from "./compose-project-name.js";
import { FliskError } from "./errors.js";
import type { DockerRun } from "./project-purge.js";
import { findOnPath } from "./which.js";

const defaultDocker: DockerRun = (args) => {
  const dockerPath = findOnPath("docker");
  if (!dockerPath) {
    throw new FliskError(
      "Docker CLI not found on PATH. Install Docker and make `docker` available on PATH, then rerun `flisk down --purge`.",
      ["Install Docker and make `docker` available on PATH", "Rerun `flisk down --purge`"],
    );
  }
  return execFileSync(dockerPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
};

const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);
const CHECKOUT_SUFFIX = /_[0-9a-f]{8}$/;

/** The shared Postgres container Flisk generates for a project. */
export function sharedPostgresContainer(projectName: string): string {
  return `${toComposeProjectName(projectName)}_postgres`;
}

/** The shared Postgres data volume Flisk generates for a project, under both Compose's old and new naming. */
export function isSharedPostgresVolume(volume: string, projectName: string): boolean {
  const prefix = toComposeProjectName(projectName);
  return (
    volume === `${prefix}_postgres_data` ||
    volume === `${projectName.toLowerCase()}-database-management_${prefix}_postgres_data`
  );
}

/** The logical databases of `projectName` that belong to one checkout, derived from the checkout suffix. */
export function checkoutDatabaseDropPlan(databases: readonly string[], suffix: string): string[] {
  return databases.filter((name) => {
    if (SYSTEM_DATABASES.has(name)) return false;
    // #4694 records an 8-hex checkout id. A main checkout owns the unsuffixed names; a linked worktree owns only names
    // ending in its own suffix, so neither can drop the other's data.
    return suffix ? name.endsWith(suffix) : !CHECKOUT_SUFFIX.test(name);
  });
}

export interface CheckoutDatabaseDrop {
  /** The suffix that identifies this checkout, or "" for the main checkout. */
  suffix: string;
  /** Databases that matched this checkout and were dropped. */
  dropped: string[];
  /** Databases that matched but Docker/Postgres refused to drop. */
  kept: { name: string; reason: string }[];
  /** Why no database was dropped, when the Postgres container could not be queried. */
  skipped?: string;
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstLine(error: unknown): string {
  const stderr = String((error as { stderr?: Buffer | string }).stderr ?? error).trim();
  return stderr.split(/\r?\n/)[0] ?? "";
}

/**
 * Drops only the current checkout's logical databases from the project's shared Postgres (#4698).
 *
 * The Postgres container and its data volume are shared by a main checkout and its linked worktrees, so a worktree's
 * `flisk down --purge` must not remove the volume. The caller filters that volume out; this function removes the
 * checkout's databases before the container is stopped. A missing or stopped container is a no-op, not a failure.
 */
export function dropCheckoutDatabases(
  projectName: string,
  suffix: string,
  docker: DockerRun = defaultDocker,
): CheckoutDatabaseDrop {
  const result: CheckoutDatabaseDrop = { suffix, dropped: [], kept: [] };
  const container = sharedPostgresContainer(projectName);
  const user = toComposeProjectName(projectName);

  let running: string[];
  let existing: string[];
  try {
    running = lines(docker(["ps", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]));
    existing = running.includes(container)
      ? running
      : lines(docker(["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"]));
  } catch (error) {
    result.skipped = `Could not ask Docker about ${container}: ${firstLine(error)}`;
    return result;
  }
  if (!existing.includes(container)) {
    result.skipped = "The shared Postgres container does not exist";
    return result;
  }
  // `flisk down` stops the stack before the purge runs, so the container is normally stopped here. Start it just long
  // enough to drop this checkout's databases (its volume keeps the other checkouts' data), then stop it again.
  const startedHere = !running.includes(container);
  if (startedHere) {
    try {
      docker(["start", container]);
      waitForPostgres(docker, container, user);
    } catch (error) {
      stopQuietly(docker, container);
      result.skipped = `Could not start ${container} to drop databases: ${firstLine(error)}`;
      return result;
    }
  }
  try {
    dropInRunningContainer(docker, container, user, suffix, result);
  } finally {
    if (startedHere) stopQuietly(docker, container);
  }
  return result;
}

function stopQuietly(docker: DockerRun, container: string): void {
  try {
    docker(["stop", container]);
  } catch {
    // The purge that follows removes the container's volumes and networks and reports anything it cannot.
  }
}

function waitForPostgres(docker: DockerRun, container: string, user: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker(["exec", container, "pg_isready", "-U", user, "-d", "postgres"]);
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw lastError;
}

function dropInRunningContainer(
  docker: DockerRun,
  container: string,
  user: string,
  suffix: string,
  result: CheckoutDatabaseDrop,
): void {
  let databases: string[];
  try {
    databases = lines(
      docker([
        "exec",
        container,
        "psql",
        "-U",
        user,
        "-d",
        "postgres",
        "-Atc",
        "SELECT datname FROM pg_database",
      ]),
    );
  } catch (error) {
    result.skipped = `Could not list databases in ${container}: ${firstLine(error)}`;
    return;
  }

  for (const name of checkoutDatabaseDropPlan(databases, suffix)) {
    // Names come from pg_database; quote them and validate them so no value can add another SQL command.
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      result.kept.push({ name, reason: "unexpected database name" });
      continue;
    }
    const quoted = `"${name}"`;
    try {
      docker([
        "exec",
        container,
        "psql",
        "-U",
        user,
        "-d",
        "postgres",
        "-c",
        `DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`,
      ]);
      result.dropped.push(name);
    } catch (error) {
      result.kept.push({ name, reason: firstLine(error) });
    }
  }
}
