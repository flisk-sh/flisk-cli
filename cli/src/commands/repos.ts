// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { basename } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { readProjectConfig } from "../generator/template-engine.js";
import { handleDryRun } from "../utils/command-helpers.js";
import { errorFactories, FliskError, requireProjectRoot } from "../utils/errors.js";
import { JsonCommandError } from "../utils/json-command.js";
import { createMachineEnvelope, toMachineError } from "../utils/machine-output.js";
import { findProjectRoot } from "../utils/paths.js";
import type { RepoDestinationState } from "../utils/project-repos.js";
import {
  classifyRepoDestination,
  cloneMissingRepos,
  planRepoClones,
  type RepoClonePlanEntry,
  redactRepoUrl,
  selectConfiguredRepos,
  validateRepoDir,
} from "../utils/project-repos.js";

/** Human `Cloned` column values, aligned with what `repos clone` will do to each destination. */
const CLONED_COLUMN_LABEL: Record<RepoDestinationState, string> = {
  cloned: "yes",
  missing: "no",
  "not a git repo": "not a git repository (clone will skip it)",
};

/** The `cloned` and `existing` lists `repos clone --json` reports, for a plan (dry run). */
function summarizePlan(plan: RepoClonePlanEntry[]) {
  const fields = (entry: RepoClonePlanEntry) => ({
    url: entry.url,
    dir: entry.dir,
    ...(entry.branch ? { branch: entry.branch } : {}),
  });
  return {
    cloned: plan.filter((entry) => entry.action === "clone").map(fields),
    existing: plan.filter((entry) => entry.action === "keep").map(fields),
  };
}

function printPlan(plan: RepoClonePlanEntry[]): void {
  for (const entry of plan) {
    const branch = entry.branch ? ` (branch: ${entry.branch})` : "";
    if (entry.action === "clone") {
      console.log(`Would clone: ${redactRepoUrl(entry.url)} into ${entry.dir}${branch}`);
    } else {
      console.log(`Would keep existing folder ${entry.dir} untouched`);
    }
  }
}

export const reposCommand = new Command("repos").description(
  "List or clone the Git repositories configured in .flisk/project.json",
);

reposCommand
  .command("list")
  .description("List configured repositories without cloning")
  .option("--json", "Print one JSON report")
  .action((options) => {
    try {
      const root = findProjectRoot();
      if (!root) throw errorFactories.notInProject();
      const repos = (readProjectConfig(root).repos ?? []).map((repo) => {
        const destination = validateRepoDir(repo.dir, root);
        if (!destination.valid || !destination.targetPath) {
          throw new FliskError(
            `Invalid repository destination "${repo.dir}": ${destination.reason}`,
            ["Fix the repos[].dir value in .flisk/project.json, then rerun this command"],
          );
        }
        const state = classifyRepoDestination(destination.targetPath);
        return {
          name: basename(destination.targetPath),
          url: redactRepoUrl(repo.url),
          path: repo.dir,
          cloned: state === "cloned",
          state,
        };
      });
      if (options.json) console.log(JSON.stringify(createMachineEnvelope({ repos }, [])));
      else if (repos.length === 0) {
        console.log(chalk.gray("No external repositories configured in .flisk/project.json."));
      } else {
        console.log("Name\tURL\tPath\tCloned");
        for (const repo of repos)
          console.log(
            `${repo.name}\t${repo.url}\t${repo.path}\t${CLONED_COLUMN_LABEL[repo.state]}`,
          );
      }
    } catch (error) {
      if (!options.json) throw error;
      const { error: failure, exitCode } = toMachineError(error);
      console.log(JSON.stringify(createMachineEnvelope(null, [failure])));
      process.exitCode = exitCode;
    }
  });

reposCommand
  .command("clone")
  .description("Clone missing service repositories configured in .flisk/project.json")
  .argument(
    "[dir...]",
    "Clone only these configured repository dirs (default: every missing repository)",
  )
  .addHelpText(
    "after",
    '\nEach entry of "repos" in .flisk/project.json has url, dir (relative to the project root), and optional branch.\nExisting directories are left untouched. flisk up also clones missing repositories.\n\nExamples:\n  flisk repos clone\n  flisk repos clone services/orders\n  flisk repos clone --dry-run\n  flisk repos clone --json\n  flisk repos clone --dry-run --json\n\nDocs: https://github.com/flisk-sh/flisk/blob/main/docs/layout.md',
  )
  .option(
    "--dry-run",
    "List the repositories that would be cloned, without creating folders or running git",
    false,
  )
  .option("--json", "Output JSON result", false)
  .action(async (dirs: string[], options) => {
    if (options.json) {
      try {
        const projectRoot = requireProjectRoot();
        const repos = selectConfiguredRepos(readProjectConfig(projectRoot).repos ?? [], dirs);
        if (options.dryRun) {
          const plan = planRepoClones(projectRoot, repos);
          console.log(
            JSON.stringify(createMachineEnvelope({ dryRun: true, ...summarizePlan(plan) }, [])),
          );
          return;
        }
        const results = repos.length > 0 ? await cloneMissingRepos(projectRoot, repos) : [];
        const failures = results.filter((r) => r.failed);
        console.log(
          JSON.stringify(
            createMachineEnvelope(
              {
                results: results.map((r) => ({
                  url: r.url,
                  dir: r.dir,
                  status: r.cloned ? "cloned" : r.failed ? "failed" : "skipped",
                  ...(r.reason ? { reason: r.reason } : {}),
                })),
                cloned: results.filter((r) => r.cloned).map((r) => ({ url: r.url, dir: r.dir })),
                existing: results.filter((r) => r.skipped).map((r) => ({ url: r.url, dir: r.dir })),
              },
              failures.map((r) => ({
                code: "REPO_CLONE_FAILED",
                message: r.reason ?? `Failed to clone ${redactRepoUrl(r.url)}`,
              })),
            ),
          ),
        );
        if (failures.length > 0) process.exitCode = 1;
      } catch (error) {
        // Every --json failure writes one error envelope on stdout, as the other --json commands do.
        // A JsonCommandError keeps its own code (an unknown dir is UNKNOWN_REPO, not REPOS_FAILED).
        const { error: machineError, exitCode } = toMachineError(error);
        const code = error instanceof JsonCommandError ? error.code : "REPOS_FAILED";
        console.log(JSON.stringify(createMachineEnvelope(null, [{ ...machineError, code }])));
        process.exitCode = exitCode;
      }
      return;
    }

    const projectRoot = requireProjectRoot();
    const config = readProjectConfig(projectRoot);
    const repos = selectConfiguredRepos(config.repos ?? [], dirs);

    if (repos.length === 0) {
      console.log(chalk.gray("No external repositories configured in .flisk/project.json."));
      return;
    }

    if (options.dryRun) {
      const plan = planRepoClones(projectRoot, repos);
      handleDryRun(
        options,
        `clone ${plan.filter((entry) => entry.action === "clone").length} missing repositories`,
        "flisk repos clone",
      );
      printPlan(plan);
      console.log("No folders were created and git was not run.");
      return;
    }

    const results = await cloneMissingRepos(projectRoot, repos);

    for (const item of results) {
      if (item.cloned) {
        console.log(chalk.green(`✓ Cloned ${item.url} into ${item.dir}`));
      } else if (item.failed) {
        console.log(
          chalk.red(
            `✗ Failed to clone ${redactRepoUrl(item.url)} into ${item.dir}: ${item.reason ?? "git clone failed"}`,
          ),
        );
      } else {
        console.log(chalk.gray(`○ Kept existing folder ${item.dir} untouched`));
      }
    }

    const counts = {
      cloned: results.filter((r) => r.cloned).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => r.failed).length,
    };
    const summaryParts: string[] = [];
    if (counts.cloned > 0) summaryParts.push(`${counts.cloned} cloned`);
    if (counts.skipped > 0) summaryParts.push(`${counts.skipped} skipped`);
    if (counts.failed > 0) summaryParts.push(`${counts.failed} failed`);
    const summary = summaryParts.join(", ");
    console.log(counts.failed > 0 ? chalk.red(summary) : chalk.gray(summary));
    if (counts.failed > 0) process.exitCode = 1;
  });
