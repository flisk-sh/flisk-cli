// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { FliskError } from "../../../utils/errors.js";
import { listProjectTemplates, PROJECT_TEMPLATES } from "../../../utils/project-templates.js";
import type { McpToolResult } from "../../server.js";
import { argSpec, guard, mcpArg, option, positional } from "../../spec-args.js";
import { flag, optionalProjectName } from "../shared.js";

/**
 * The project family: the project's own record (`project_info`, `project_templates`) and the commands that write into a
 * directory (`project_init`, `project_import`) or back out of it (`project_eject`). Each tool's arguments are
 * declared once in an argSpec table bound to the command's generated spec.
 */

/** Cloning a starter repository can outlast the default two minutes. */
export const PROJECT_INIT_TIMEOUT_MS = 300_000;
/** `flisk import` fetches flisk-import through npx first, which can outlast the default two minutes too. */
export const IMPORT_TIMEOUT_MS = 300_000;

/** The `project_info` tool's arguments, bound to the `flisk projects` spec. */
export const projectInfoArgs = argSpec(["projects"], ["--json"]);

/** `flisk projects --json`: the project at projectPath (or the server's directory). */
export function buildProjectInfoArgs(): string[] {
  return projectInfoArgs.build({});
}

/** `project_templates` is data the server already has; no CLI run. */
export const projectTemplatesRun = () => async (): Promise<McpToolResult> => ({
  data: { templates: listProjectTemplates() },
  isError: false,
});

/** The `project_init` tool's arguments, bound to the `flisk project` spec. */
export const projectInitArgs = argSpec(
  ["project"],
  [
    positional("template", {
      as: "choice",
      choices: Object.keys(PROJECT_TEMPLATES),
      description: "Clone this starter project instead of creating a blank one",
    }),
    option("--path", {
      as: "path",
      description:
        "Template only: directory to clone into, relative to projectPath or absolute (default: the starter name, or its repository name)",
    }),
    option("--name", {
      arg: "name",
      as: "raw",
      coerce: (value) => optionalProjectName(value, "name"),
      description:
        "Blank project only: set project.name (lowercase letters, numbers, hyphens; default: the folder's name made compatible)",
    }),
    // The command ignores these in the other mode; refusing them keeps a caller from believing they applied.
    guard((args) => {
      if (args.path !== undefined && args.template === undefined) {
        throw new FliskError("path applies only with a template", ["Drop path, or pass template"]);
      }
      if (args.template !== undefined && args.name !== undefined) {
        throw new FliskError("name applies only to a blank project, not to a template", [
          "Drop name, or omit template",
        ]);
      }
      if (args.template !== undefined && args.agentSkills !== undefined) {
        throw new FliskError("agentSkills applies only to a blank project, not to a template", [
          "Drop agentSkills, or omit template",
        ]);
      }
    }),
    option("--no-agent-skills", {
      arg: "agentSkills",
      description: "Blank project only: write the Flisk agent skills and AGENTS.md (default true)",
    }),
    "--yes",
  ],
);

/** `flisk project [template] --yes`. Never `--force`, which overwrites an existing .flisk/project.json. */
export function buildProjectInitArgs(args: Record<string, unknown>): string[] {
  return projectInitArgs.build(args);
}

/** The `project_eject` tool's arguments, bound to the `flisk eject` spec. */
export const projectEjectArgs = argSpec(
  ["eject"],
  [
    mcpArg("confirm", {
      type: "boolean",
      description: "Must be true to write EJECTED.md; without it only a dry run is allowed",
    }),
    option("--dry-run", {
      arg: "dryRun",
      description: "List the generated files and what would be written, without writing",
    }),
    // A real run writes EJECTED.md into the project, so it is refused unless `confirm` is true;
    // a dry run changes nothing and needs no confirmation.
    guard((args) => {
      if (!flag(args.dryRun, "dryRun") && !flag(args.confirm, "confirm")) {
        throw new FliskError(
          "project_eject writes EJECTED.md into the project; it needs confirm: true",
          [
            "Pass confirm: true to eject",
            "Pass dryRun: true to list the generated files and what would be written, without confirm",
          ],
        );
      }
    }),
    // A confirmed real run means --yes: emitted when dryRun resolves false.
    option("--yes", { arg: "dryRun", when: false, schema: false }),
    "--json",
  ],
);

/**
 * `flisk eject --json`. A real run writes EJECTED.md into the project, so it is refused unless `confirm` is true; a dry run
 * changes nothing and needs no confirmation.
 */
export function buildProjectEjectArgs(args: Record<string, unknown>): string[] {
  return projectEjectArgs.build(args);
}

/** The `project_import` tool's arguments, bound to the `flisk import` spec. */
export const projectImportArgs = argSpec(
  ["import"],
  [
    // `force` overwrites an existing service.json, so a real run with it is refused unless
    // `confirm` is true (a dry run changes nothing). The gate runs before the dir check, the
    // same order the hand-written builder had.
    guard((args) => {
      if (
        flag(args.force, "force") &&
        !flag(args.dryRun, "dryRun") &&
        !flag(args.confirm, "confirm")
      ) {
        throw new FliskError(
          "project_import with force overwrites existing service.json files; it needs confirm: true",
          [
            "Ask the user, then pass confirm: true together with force: true",
            "Pass dryRun: true to see the plan without confirm",
            "Drop force to import without overwriting an existing service.json",
          ],
        );
      }
    }),
    positional("args", {
      arg: "dir",
      as: "path",
      description:
        "Directory with the docker-compose.yml, relative to projectPath or absolute (default: projectPath)",
    }),
    option("--dry-run", { arg: "dryRun" }),
    option("--force", { arg: "force" }),
    "--json",
    mcpArg("confirm", {
      type: "boolean",
      description: "Must be true together with force (unless dryRun) to overwrite files",
    }),
  ],
);

/**
 * `flisk import [dir] --json`, which writes without a prompt unless `dryRun` is set. `dir` comes before the flags. `force`
 * overwrites an existing service.json, so a real run with it is refused unless `confirm` is true (a dry run changes nothing).
 */
export function buildProjectImportArgs(args: Record<string, unknown>): string[] {
  return projectImportArgs.build(args);
}
