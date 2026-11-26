// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { CheckResult } from "../../../types/index.js";
import { PACKAGE_JSON } from "../../constants.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";
import { COMMENT_LINE, listSourceFiles, readText } from "./shared.js";

/** The common ways to apply schema changes from a command line: Prisma, Drizzle, Knex, TypeORM, MikroORM, Sequelize, dbmate, Atlas, Alembic. */
const MIGRATION_COMMAND =
  /\b(?:prisma\s+(?:migrate\s+(?:deploy|dev|resolve)|db\s+push)|drizzle-kit\s+(?:migrate|push)|knex\s+migrate:\w+|typeorm\s+migration:run|mikro-orm\s+migration:up|sequelize(?:-cli)?\s+db:migrate|dbmate\s+(?:up|migrate)|atlas\s+migrate\s+apply|alembic\s+upgrade)\b/;
export const START_SCRIPTS = new Set(["start", "dev", "serve", "prestart", "predev", "preserve"]);
const SHELL_ENTRYPOINT = /\.(?:sh|bash)$/;
const DOCKERFILE_START = /^\s*(?:CMD|ENTRYPOINT)\b/i;

function startScriptMigrations(resourceDir: string): string[] {
  const text = readText(join(resourceDir, PACKAGE_JSON));
  if (text === undefined) return [];
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(text)?.scripts ?? {};
  } catch {
    return [];
  }
  return Object.entries(scripts)
    .filter(
      ([name, command]) =>
        START_SCRIPTS.has(name) && typeof command === "string" && MIGRATION_COMMAND.test(command),
    )
    .map(([name]) => `package.json "${name}" script`);
}

export function fileMigrations(path: string, onlyStartLines: boolean): boolean {
  const text = readText(path);
  if (text === undefined) return false;
  return text.split("\n").some(
    (line) =>
      // `["prisma", "migrate", "deploy"]` is the same command as `prisma migrate deploy`.
      MIGRATION_COMMAND.test(line.replace(/["'`,[\]]+/g, " ")) &&
      !COMMENT_LINE.test(line) &&
      (!onlyStartLines || DOCKERFILE_START.test(line)),
  );
}

/**
 * A backend or worker that applies migrations from its own start-up (a `start` script, a Dockerfile CMD,
 * an entrypoint script or its source) races its siblings and runs again on every restart. Flisk has a
 * `migrator` app type for this: it runs once, before the services that depend on it. This is a warning,
 * not a failure: such services work, and the opt-in Infisical entrypoint is one of them.
 */
export function checkMigrationsInApi(
  projectRoot = findProjectRoot() ?? process.cwd(),
): CheckResult {
  const findings: string[] = [];

  for (const resource of discoverResourcesFromRoot(projectRoot)) {
    const appType = resource.config?.appType ?? resource.type;
    if (appType !== "backend" && appType !== "worker") continue;
    const dir = resource.path;

    for (const finding of startScriptMigrations(dir)) findings.push(`${resource.name}: ${finding}`);

    const dockerfile = join(dir, resource.config?.dockerfile ?? "Dockerfile");
    if (fileMigrations(dockerfile, true)) {
      findings.push(`${resource.name}: ${relative(projectRoot, dockerfile)} CMD or ENTRYPOINT`);
    }

    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && SHELL_ENTRYPOINT.test(entry.name) && fileMigrations(path, false)) {
        findings.push(`${resource.name}: ${relative(projectRoot, path)}`);
      }
    }
    for (const path of listSourceFiles(join(dir, "src"))) {
      if (fileMigrations(path, false))
        findings.push(`${resource.name}: ${relative(projectRoot, path)}`);
    }
  }

  if (findings.length === 0) {
    return {
      name: "Migrations outside the API",
      didPass: true,
      message: "No backend or worker runs a migration command from its own start-up",
    };
  }
  return {
    name: "Migrations outside the API",
    didPass: false,
    isWarning: true,
    message: `${formatCount(findings.length, "migration command")} run from a backend or worker's own start-up:\n    ${findings.join("\n    ")}`,
    fix: "Move the migration into a `migrator` resource (appType migrator) that the service depends on, so it runs once before the service starts instead of on every start and restart",
  };
}
