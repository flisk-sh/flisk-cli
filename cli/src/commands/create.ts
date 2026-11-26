// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * `flisk create`: pick what you are building with a few key presses, then get a project that runs.
 *
 * This file is only the journey. What can be built comes from Flisk's generator registries (create-catalog.ts), the project is
 * built by the real `flisk project` and `flisk resource` commands (create-plan.ts), and the next steps are read back from what
 * those commands wrote. It keeps no list of frameworks, languages or starters of its own.
 *
 * The journey itself is split under `create/`: `answers.ts` is the prompt and flag flow, `review.ts`
 * the pre-write summary and confirmation, `install-plan.ts` the plan's execution, install and start,
 * and `recovery.ts` the generated-project reporting and failure message. Everything this file used to
 * export stays exported through it, so its importers see no change.
 */

import { resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import type { JsonCommandResult } from "../types/index.js";
import { PromptCancelled } from "../utils/arrow-prompt.js";
import { projectNeedsDatabaseKeys } from "../utils/capabilities.js";
import { cliInvocation } from "../utils/cli-invocation.js";
import { addYesOption, routeUsageErrorsToJson } from "../utils/command-helpers.js";
import { buildCreatePlan, isValidProjectName, projectNameError } from "../utils/create-plan.js";
import { projectConfigEnablesVerdaccio } from "../utils/doctor/process.js";
import { regenerateEnvFile } from "../utils/env-validator.js";
import { FliskError, runCommand } from "../utils/errors.js";
import { runJsonCommand } from "../utils/json-command.js";
import { findProjectRoot } from "../utils/paths.js";
import {
  type CreateOptions,
  collectAnswers,
  installHelp,
  isInteractive,
} from "./create/answers.js";
import {
  assertFolderIsFree,
  claimFolder,
  createdResources,
  createJsonData,
  dryRunResult,
  installServices,
  resolveStartIntent,
  runPlanSteps,
  startBlockers,
  startProject,
  writeProjectReadme,
} from "./create/install-plan.js";
import { generatedServices, nextSteps } from "./create/recovery.js";
import { confirmCreate } from "./create/review.js";

// Re-exported so every import that reached the single create.ts file still works unchanged.
export {
  type CreateOptions,
  collectAnswers,
  installHelp,
  isInteractive,
} from "./create/answers.js";
export {
  assertFolderIsFree,
  type CreateJsonData,
  type CreateJsonResource,
  claimFolder,
  createdResources,
  createJsonData,
  dryRunResult,
  installServices,
  renderStep,
  resolveStartIntent,
  runPlanSteps,
  splitCommand,
  startBlockers,
  startProject,
  writeProjectReadme,
} from "./create/install-plan.js";
export {
  commandFailureTail,
  firstPort,
  type GeneratedService,
  generatedServices,
  installFailureSuggestions,
  localInstallHint,
  nextSteps,
  recoveryMessage,
  whereToOpen,
} from "./create/recovery.js";
export { confirmCreate, reviewLines } from "./create/review.js";

export const createCommand = routeUsageErrorsToJson(addYesOption(new Command("create")))
  .description("Pick what you are building with a few key presses and get a project that runs")
  .addHelpText(
    "after",
    "\nExamples:\n  flisk create\n  flisk create my-app --yes --start\n  flisk create shop --frontend react --backend hono\n  flisk create api --runtime docker --extras worker,queue:nats\n  flisk create --dry-run",
  )
  .argument("[name]", "Project folder to create (default: my-app)")
  .option("--starter <name>", "A ready-made starter project (see flisk project --list)")
  .option(
    "--runtime <runtime>",
    "local (plain processes on your computer; default) or docker (Docker and Tilt)",
  )
  .option(
    "--frontend <id>",
    "Website framework (see flisk resource --frameworks --type frontend), or none",
  )
  .option(
    "--backend <id>",
    "API framework (see flisk resource --frameworks --type backend), or none",
  )
  .option("--language <id>", "API language (see flisk resource --help)")
  .option(
    "--extras <list>",
    "Docker runtime: extra parts, comma-separated (worker, queue:nats, database:redis…), or none",
  )
  .option("--dry-run", "Print the commands that would run, and stop", false)
  .option(
    "--start",
    "Install dependencies and start what was written (the local app route; a starter is never started here)",
    false,
  )
  .option("--json", "Print one JSON envelope on stdout; progress goes to stderr", false)
  .action(async (nameArg: string | undefined, options: CreateOptions) => {
    const action = async (): Promise<JsonCommandResult> => {
      try {
        return await runCreate(nameArg, options);
      } catch (error) {
        if (!(error instanceof PromptCancelled)) throw error;
        console.log(chalk.dim("\nCancelled. Nothing was written."));
        process.exitCode = 130;
        return { data: { cancelled: true }, exitCode: 130 };
      }
    };
    if (options.json) {
      // The shared path moves every progress line to stderr and emits exactly one envelope, including on errors.
      await runJsonCommand("CREATE_FAILED", "flisk create", action);
      return;
    }
    await runCommand(action);
  });

/**
 * `flisk project --yes` writes `.env` while the project is still empty, so it cannot know that the resources which follow
 * run as local processes. Once they exist, rewrite that generated file with the keys the finished project needs (#3711).
 */
function regenerateProjectEnvFile(projectDir: string): void {
  regenerateEnvFile(projectDir, {
    databaseKeys: projectNeedsDatabaseKeys(projectDir),
    verdaccio: projectConfigEnablesVerdaccio(projectDir),
  });
}

/**
 * The create journey: collect the answers, show the review, run the plan, then hand over. A starter is handed to
 * its README; a local app may install and start itself (the ask, or --start); the Docker route is started with flisk up app.
 */
async function runCreate(
  nameArg: string | undefined,
  options: CreateOptions,
): Promise<JsonCommandResult> {
  // `create` makes a new root; unlike the other commands it must not walk up into an enclosing project.
  // Without this, `project --yes` writes .flisk there while the README lands in the requested folder (#5426).
  const enclosingProject = findProjectRoot();
  if (enclosingProject) {
    throw new FliskError(
      `${enclosingProject} is already a Flisk project. Run create outside it, or use flisk resource to add a service here.`,
      [
        "Change to a directory outside that project and run `flisk create <name>` again",
        "To add a service to this project instead, run `flisk resource <name> --type <type>`",
      ],
    );
  }

  // An agent reading stdout must never be asked a question, even when stdout happens to be a terminal.
  const interactive =
    !options.json &&
    isInteractive(options, {
      in: process.stdin.isTTY === true,
      out: process.stdout.isTTY === true,
    });

  if (interactive) {
    console.log(chalk.bold("\nLet's create your project"));
    console.log(chalk.dim("Start with a working default. Type to filter a long list.\n"));
  }

  const answers = await collectAnswers(nameArg, options, interactive);
  if (!isValidProjectName(answers.name)) {
    const { message, suggestions } = projectNameError(answers.name);
    throw new FliskError(message, suggestions);
  }
  const projectDir = resolve(process.cwd(), answers.name);
  assertFolderIsFree(projectDir);
  const steps = buildCreatePlan(answers);

  if (options.dryRun) {
    return dryRunResult(answers, projectDir, steps, { start: Boolean(options.start) });
  }

  if (!(await confirmCreate(answers, steps, interactive))) {
    console.log(chalk.dim("\nCancelled. Nothing was written."));
    process.exitCode = 130;
    return { data: { cancelled: true }, exitCode: 130 };
  }

  const invocation = cliInvocation();

  // Re-check right before writing: the folder may have changed since the first check and the confirmation.
  // A starter's generator accepts the empty folder this leaves, so starters get the same protection as apps.
  const createdFolder = claimFolder(projectDir);

  runPlanSteps(invocation, steps, projectDir, createdFolder);
  // The project step made .env before the services existed; now that they do, give the file the right keys (#3711).
  regenerateProjectEnvFile(projectDir);

  console.log(`\n${chalk.green("✔")} Created ${chalk.bold(answers.name)}`);
  const services = generatedServices(projectDir, answers);

  // A starter is ready-made and may need Docker, a database or other setup its own README describes. create writes it and
  // stops: it never installs, never starts Docker, Tilt or a stack, not even with --start.
  if (answers.starter) {
    const next = nextSteps(projectDir, answers);
    console.log(`\nNext:\n${next.map((line) => `  ${line}`).join("\n")}\n`);
    return {
      data: createJsonData(answers, projectDir, steps, createdResources(projectDir), next, false),
    };
  }

  writeProjectReadme(projectDir, answers, services);

  const start = await resolveStartIntent(answers, interactive, Boolean(options.start));
  const next = nextSteps(projectDir, answers, services);
  if (!start) {
    console.log(`\nNext:\n${next.map((line) => `  ${line}`).join("\n")}\n`);
    return {
      data: createJsonData(answers, projectDir, steps, createdResources(projectDir), next, false),
    };
  }

  // Check the programs before installing anything, so a missing toolchain is one clear message, not a failed install.
  const missing = startBlockers(answers);
  if (missing.length > 0) {
    throw new FliskError(
      `The project is created, but it cannot start yet: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not installed.`,
      [
        ...installHelp(missing).map((line) => line.trim()),
        `Then, in ${JSON.stringify(projectDir)}: ${[
          ...services.flatMap((service) =>
            service.install ? [`(cd ${service.dir} && ${service.install})`] : [],
          ),
          "flisk up",
        ].join(" ; ")}`,
      ],
    );
  }

  // Install what the generators wrote.
  await installServices(projectDir, answers, services);
  startProject(invocation, projectDir, answers, services, { json: options.json });
  return {
    data: createJsonData(answers, projectDir, steps, createdResources(projectDir), next, false),
  };
}
