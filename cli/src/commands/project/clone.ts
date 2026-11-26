// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { cwd, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import {
  generateMasterConfigs,
  projectNeedsContainerFiles,
  readProjectConfig,
} from "../../generator/template-engine.js";
import type { DiscoveredResource, ProjectConfig } from "../../types/index.js";
import { PROJECT_JSON } from "../../utils/constants.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import { completeEnvFile, ensureEnvFile } from "../../utils/env-validator.js";
import { errorFactories, FliskError, showErrorAndExit } from "../../utils/errors.js";
import { ensureDirectory, writeJsonFile } from "../../utils/file-helpers.js";
import { showCommandHeader, showDetail } from "../../utils/formatting.js";
import { writeLanggraphProject } from "../../utils/langgraph-template.js";
import { writeNextPostgresProject } from "../../utils/next-postgres-template.js";
import { LOCKFILE_COMMAND } from "../../utils/npm-lockfile.js";
import { PROJECT_FEATURES } from "../../utils/project-features.js";
import {
  PROJECT_TEMPLATES,
  resolveBundledTemplateDir,
  templateGitCommands,
  templateTargetDir,
} from "../../utils/project-templates.js";
import { writeSecurityProject } from "../../utils/security-template.js";
import { discoverStackNames } from "../../utils/services.js";
import { writeSuperAgentProject } from "../../utils/super-agent-template.js";
import { writeSwarmProject } from "../../utils/swarm-template.js";
import { stripTemplateExtras } from "../../utils/template-extras.js";
import { writeToolLoopProject } from "../../utils/tool-loop-template.js";
import { deriveProjectName, isTargetDirSafe } from "../../utils/validation.js";
import { findOnPath } from "../../utils/which.js";
import { exitUnknownTemplate, formatProjectPaths } from "./template-catalog.js";

/**
 * Stack names discovered from service.json files already in the repo (e.g. a
 * cloned starter template). Tilt's discovery groups app resources by this
 * same `stack` field, so a stack must appear here to ever be enabled by
 * `should_enable()` - without it, `flisk up` would launch infra only and no
 * app services would come up, however many the repo actually has.
 */
export function discoverExistingServiceStacks(
  projectRoot: string,
  resources?: DiscoveredResource[],
): string[] {
  try {
    return discoverStackNames(projectRoot, resources);
  } catch {
    return [];
  }
}

function getAssignedStackServices(projectConfig: Pick<ProjectConfig, "phases">): Set<string> {
  return new Set([
    ...projectConfig.phases.pre_alpha.enabledStacks,
    ...projectConfig.phases.alpha.enabledStacks,
    ...projectConfig.phases.beta.enabledStacks,
    ...projectConfig.phases.out_of_scope.enabledStacks,
  ]);
}

export function syncDiscoveredStacksToPreAlpha(
  projectConfig: ProjectConfig,
  discoveredStacks: string[],
): string[] {
  const assignedServices = getAssignedStackServices(projectConfig);
  const missingStacks = discoveredStacks.filter((stack) => !assignedServices.has(stack));

  if (missingStacks.length === 0) {
    projectConfig.phases.pre_alpha.enabledStacks = Array.from(
      new Set(projectConfig.phases.pre_alpha.enabledStacks),
    );
    return [];
  }

  projectConfig.phases.pre_alpha.enabledStacks = Array.from(
    new Set([...projectConfig.phases.pre_alpha.enabledStacks, ...missingStacks]),
  );

  return missingStacks;
}

/**
 * Adds stacks that have service.json files but aren't in any phase to
 * pre_alpha, so a resource scaffolded after `flisk project` is picked up by
 * `flisk up` without re-running `flisk project`. Returns the stacks it enabled.
 */
export function enableDiscoveredStacks(
  projectRoot: string,
  resources?: DiscoveredResource[],
): string[] {
  const projectJsonPath = join(projectRoot, ".flisk", PROJECT_JSON);
  if (!existsSync(projectJsonPath)) return [];

  const projectConfig = readProjectConfig(projectRoot);
  const enabled = syncDiscoveredStacksToPreAlpha(
    projectConfig,
    discoverExistingServiceStacks(projectRoot, resources),
  );
  if (enabled.length > 0) {
    writeJsonFile(projectJsonPath, projectConfig);
  }
  return enabled;
}

/**
 * Get core infrastructure services from PROJECT_FEATURES that are enabled by default
 */
function getDefaultCoreServices(): string[] {
  return Object.values(PROJECT_FEATURES)
    .filter((f) => f.enabled_by_default && f.category === "core")
    .map((f) => f.name);
}

/** The last non-empty line of a child process error, for a one-line failure message. */
export function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.pop() ?? "unknown error";
}

/** Clones (or copies) a starter template and resolves to the absolute directory it landed in. */
export async function cloneProjectTemplate(
  templateName: string,
  targetDir: string | undefined,
  runtimeNextSteps: string[],
  options: { quiet?: boolean } = {},
): Promise<string> {
  const template = PROJECT_TEMPLATES[templateName];

  if (!template || !Object.hasOwn(PROJECT_TEMPLATES, templateName)) {
    exitUnknownTemplate(templateName);
  }

  const dirName = templateTargetDir(templateName, targetDir);

  if (!isTargetDirSafe(dirName)) {
    errorFactories.invalidPath(dirName).exit();
  }

  // If targetDir is an absolute path, use it directly as the destination
  // Otherwise resolve it relative to cwd()
  const destination = isAbsolute(dirName) ? dirName : resolve(cwd(), dirName);
  const { displayDirWithSlash, cdCommands } = formatProjectPaths(dirName);

  if (existsSync(destination) && readdirSync(destination).length > 0) {
    errorFactories.directoryExists(destination).exit();
  }

  if (!options.quiet) {
    showCommandHeader(`Cloning template: ${templateName}`);
    showDetail(`${template.description}\n`, 0);
    showDetail(
      `Source: ${template.bundledPath || template.generated || template.composed ? "bundled Flisk example" : template.repo}`,
      0,
    );
    if (template.ref) showDetail(`Commit: ${template.ref}`, 0);
    showDetail(`Destination: ${destination}\n`, 0);
  }

  let gitStep: "clone" | "checkout" | "remote" = "clone";
  let bundledCopyUsed = false;
  const gitBin = findOnPath("git") ?? "git";
  try {
    if (template.generated === "swarm") {
      writeSwarmProject(destination);
    } else if (template.generated === "security") {
      writeSecurityProject(destination);
    } else if (template.generated === "super-agent") {
      writeSuperAgentProject(destination);
    } else if (template.generated === "langgraph") {
      writeLanggraphProject(destination);
    } else if (template.generated === "tool-loop") {
      writeToolLoopProject(destination);
    } else if (template.composed === "next-postgres") {
      const lock = writeNextPostgresProject(destination);
      if (!lock.ok) {
        console.log(
          chalk.yellow(
            `⚠️  No package-lock.json for the web resource (${lock.reason}). The image build needs one: run \`${LOCKFILE_COMMAND}\` in ${join(destination, "services/app/web")}.`,
          ),
        );
      }
    } else if (template.bundledPath) {
      const bundledSource = resolveBundledTemplateDir(template.bundledPath, {
        packageRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../"),
        exeDir: dirname(execPath),
        workingDir: cwd(),
      });
      if (bundledSource) {
        bundledCopyUsed = true;
        cpSync(bundledSource, destination, { recursive: true });
      } else {
        // No bundled copy (standalone binary whose engine bundle predates #3880): clone the same example.
        for (const gitArgs of templateGitCommands(template, destination)) {
          gitStep =
            gitArgs[0] === "clone" ? "clone" : gitArgs[2] === "remote" ? "remote" : "checkout";
          execFileSync(gitBin, gitArgs, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
        }
      }
      const projectSlug = basename(destination).replace(/-/g, "_");
      for (const file of [
        "services/platform/messaging/docker-compose.yml",
        "services/shop/orders-api/service.json",
        "services/shop/orders-api/src/index.ts",
        "services/shop/orders-worker/service.json",
        "services/shop/orders-worker/src/index.ts",
      ]) {
        const copiedPath = join(destination, file);
        if (!existsSync(copiedPath)) continue;
        const contents = readFileSync(copiedPath, "utf-8");
        writeFileSync(copiedPath, contents.replaceAll("flisk_example", projectSlug));
      }
    } else {
      // Piped, not inherited: a raw git progress dump is noise for the caller and, in the
      // one-command flow, it interleaves with the frame that is already on screen.
      for (const gitArgs of templateGitCommands(template, destination)) {
        gitStep =
          gitArgs[0] === "clone" ? "clone" : gitArgs[2] === "remote" ? "remote" : "checkout";
        execFileSync(gitBin, gitArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf-8",
        });
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      template.bundledPath && bundledCopyUsed
        ? `Bundled example copy failed (${lastLine(detail)}). Reinstall the Flisk CLI package and try again.`
        : gitStep === "remote"
          ? `git remote rename origin upstream failed: ${lastLine(detail)}. The cloned repository is left in ${destination}; inspect its remotes before trying again.`
          : gitStep === "checkout"
            ? `git checkout of the pinned commit ${template.ref} failed: ${lastLine(detail)}. ${destination} is left at the default branch; delete it before trying again.`
            : `git clone failed: ${lastLine(detail)}. Check you have git installed and network access.`;
    // A caller that paints its own surface (the one-command flow) needs to report the
    // failure itself instead of having the process die mid-paint.
    if (options.quiet) {
      throw new FliskError(message, [
        template.bundledPath && bundledCopyUsed
          ? "Reinstall the Flisk CLI package, then run the command again"
          : "Check that git is installed and that you are online, then run the command again",
      ]);
    }
    showErrorAndExit(message);
  }

  // A template is copied whole, including sales decks and demo guides that describe the template rather than
  // the user's project. Drop the catalog's presentation paths and their README links before the first commit (#4301).
  if (template.omit) stripTemplateExtras(destination, template.omit);

  // A copied or cloned starter ships service.json files but no .flisk/project.json, and every command that needs a
  // project root refuses without one: `flisk doctor`, `flisk status` and `flisk resources` in the new folder failed
  // with "Could not find project root". Generated local-process starters get it too (#4292).
  if (!existsSync(join(destination, ".flisk", PROJECT_JSON))) {
    writeDefaultProjectConfig(destination);
  }

  clearDiscoveryCache();

  // Generate the master files now, the same way `flisk project` does for a blank project. A fresh
  // scaffold otherwise has no .flisk/.flisk-out/ files, so `flisk config verify` fails on minute one
  // even though nobody edited anything (#4196). Local-process starters need no container files, so
  // they skip the extra work. Keep this quiet: the printed next steps are unchanged on success.
  const needsContainerFiles = projectNeedsContainerFiles(destination);
  let masterFilesGenerated = !needsContainerFiles;
  if (needsContainerFiles) {
    try {
      await generateMasterConfigs(destination, { quiet: true });
      masterFilesGenerated = true;
    } catch (error) {
      // An incomplete starter config must not make scaffolding fail. `config verify` still reports
      // the missing files, so point at the exact command that finishes the lazy generation.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(chalk.yellow(`⚠️  Could not generate the master files yet: ${reason}\n`));
    }

    // A starter's .env is git-ignored, so a clone never ships one: `flisk doctor`, the printed
    // step 2, then fails its env check on a project nobody touched and points back at `flisk
    // project` (#3883). Write the same defaults `flisk project --yes` writes; a .env the starter
    // does ship is completed, never overwritten.
    if (!ensureEnvFile(destination)) {
      completeEnvFile(destination);
    }
  }

  if (options.quiet) return destination;

  const printCdStep = () => {
    const [first, ...rest] = cdCommands;
    showDetail(`1. ${first}`);
    for (const alt of rest) showDetail(`   ${alt}`);
  };

  if (template.generated) {
    // Every service of a generated starter declares `command`: it runs as local processes, with no Docker or Tilt.
    console.log(chalk.green(`\n✅ Created "${templateName}" in ${displayDirWithSlash}`));
    showDetail("\nNext steps:", 0);
    printCdStep();
    showDetail("2. flisk up       # start it as local processes (no Docker needed)");
    showDetail("3. cat README.md  # what to send it");
    return destination;
  }

  if (template.composed) {
    console.log(chalk.green(`\n✅ Created "${templateName}" in ${displayDirWithSlash}`));
    showDetail("\nNext steps:", 0);
    printCdStep();
    if (masterFilesGenerated) {
      showDetail(
        "2. flisk up       # Postgres, the migrator, the API and the website (needs Docker)",
      );
      showDetail("3. cat README.md  # what each part does");
    } else {
      showDetail("2. flisk config regenerate  # create the generated files");
      showDetail(
        "3. flisk up                 # Postgres, the migrator, the API and the website (needs Docker)",
      );
      showDetail("4. cat README.md            # what each part does");
    }
    return destination;
  }

  console.log(chalk.green(`\n✅ Cloned "${templateName}" into ${displayDirWithSlash}`));
  showDetail("\nNext steps:", 0);
  printCdStep();
  if (masterFilesGenerated) {
    showDetail("2. flisk doctor   # check Docker/Tilt are ready");
    showDetail("3. flisk up       # start the stack");
  } else {
    showDetail("2. flisk config regenerate  # create the generated files");
    showDetail("3. flisk doctor             # check Docker/Tilt are ready");
    showDetail("4. flisk up                 # start the stack");
  }
  if (!template.bundledPath) {
    showDetail(
      "\nThe starter is the git remote upstream; add your own with git remote add origin <url>.",
      0,
    );
  }
  showDetail("\nRuntime readiness:", 0);
  for (const line of runtimeNextSteps) showDetail(line, 0);
  return destination;
}

export const DEFAULT_PROJECT_JSON: ProjectConfig = {
  version: "1.0",
  project: {
    name: "",
    version: "1.0.0",
  },
  phases: {
    pre_alpha: {
      name: "Pre-Alpha",
      description: "Core infrastructure and MVP services",
      enabledStacks: getDefaultCoreServices(),
    },
    alpha: {
      name: "Alpha",
      description: "Essential business services",
      enabledStacks: [] as string[],
    },
    beta: {
      name: "Beta",
      description: "Extended features",
      enabledStacks: [] as string[],
    },
    out_of_scope: {
      name: "Out of Scope",
      description: "Future releases",
      enabledStacks: [] as string[],
    },
  },
  optional_infra: {
    monitoring: false,
    elk: false,
    debezium: false,
    golden_image: true,
    verdaccio: false,
  },
  discovery: {
    // Generic PSR layout (services/<stack>/<resource>/service.json) - every Flisk example
    // repo (restaurant, saas-starter, user-management, ...) uses its own stack names here,
    // not the literal "product"/"platform" folders from the internal platform monorepo.
    paths: ["services/*/*"],
  },
  overrides: {},
};

/**
 * Writes .flisk/project.json with the defaults `flisk project --yes` uses, and nothing else: no generated Tiltfile, Compose file,
 * .env or engine copy. `flisk up` uses it to adopt a directory of `command` services as a project, so `flisk down` and
 * `flisk doctor` find it afterwards.
 */
export function writeDefaultProjectConfig(projectRoot: string): void {
  const projectConfig = JSON.parse(JSON.stringify(DEFAULT_PROJECT_JSON)) as ProjectConfig;
  projectConfig.project.name = deriveProjectName(basename(projectRoot), projectRoot);
  ensureDirectory(join(projectRoot, ".flisk"));
  writeJsonFile(join(projectRoot, ".flisk", PROJECT_JSON), projectConfig);
}
