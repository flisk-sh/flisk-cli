// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readdirSync, readFileSync, realpathSync, rmdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import { Command } from "commander";
import { generateMasterConfigs, readProjectConfig } from "../generator/template-engine.js";
import type { JsonCommandResult, ProjectConfig } from "../types/index.js";
import {
  claudeGuardHookNeedsWiring,
  installAgentSkills,
  PROJECT_CLAUDE_SETTINGS,
} from "../utils/agent-skills.js";
import { writeTextFileAtomic } from "../utils/atomic-write.js";
import type { RuntimePrerequisiteStatus } from "../utils/cold-preflight.js";
import { addYesOption } from "../utils/command-helpers.js";
import { DEFAULT_STACK_NAME, MASTER_CONFIG_FILES, PROJECT_JSON } from "../utils/constants.js";
import { projectConfigEnablesVerdaccio } from "../utils/doctor/process.js";
import { shellQuote } from "../utils/doctor-runtime.js";
import { completeEnvFile, ensureEnvFile, validateEnvFile } from "../utils/env-validator.js";
import { FliskError, runCommand } from "../utils/errors.js";
import { ensureDirectory, ensureGitignore, findGitWorkTreeRoot } from "../utils/file-helpers.js";
import {
  showCancelled,
  showCommandHeader,
  showDetail,
  showStep,
  showSuccess,
} from "../utils/formatting.js";
import { runJsonCommand } from "../utils/json-command.js";
import { findProjectRoot } from "../utils/paths.js";
import { PROJECT_FEATURES } from "../utils/project-features.js";
import { preflightProjectFolder } from "../utils/project-preflight.js";
import { PROJECT_TEMPLATES } from "../utils/project-templates.js";
import { promptConfirm, promptMultiSelect, promptText } from "../utils/prompt.js";
import { cleanStaleVolumesForScaffold } from "../utils/scaffold-volume-cleanup.js";
import { deriveProjectName, validateProjectName } from "../utils/validation.js";
import {
  cloneProjectTemplate,
  DEFAULT_PROJECT_JSON,
  discoverExistingServiceStacks,
  enableDiscoveredStacks,
  lastLine,
  syncDiscoveredStacksToPreAlpha,
  writeDefaultProjectConfig,
} from "./project/clone.js";
import {
  backupProjectJson,
  formatProjectConfigChanges,
  projectConfigChanges,
} from "./project/force-reset.js";
import {
  ACTION_WORD_HINTS,
  actionWordHint,
  exitUnknownTemplate,
  formatProjectPaths,
  type ProjectShell,
  printTemplateCatalog,
} from "./project/template-catalog.js";

export type { ProjectShell };
// The catalog, clone and config helpers moved into commands/project/ (#4891); this
// module keeps exporting every one of them so existing imports keep working.
export {
  ACTION_WORD_HINTS,
  actionWordHint,
  cloneProjectTemplate,
  enableDiscoveredStacks,
  exitUnknownTemplate,
  formatProjectPaths,
  lastLine,
  printTemplateCatalog,
  writeDefaultProjectConfig,
};

/** Verdaccio is a paid, off-by-default service; only a project that asks for it gets its URL keys (#3711). */
function envKeyOptions(projectRoot: string): { verdaccio: boolean } {
  return { verdaccio: projectConfigEnablesVerdaccio(projectRoot) };
}

/**
 * Removes a `.flisk/` directory only when this invocation created it and it is
 * still empty. A pre-existing directory, or anything written into it in the
 * meantime, is left alone.
 */
function removeEmptyCreatedDirectory(dirPath: string): void {
  try {
    if (readdirSync(dirPath).length === 0) rmdirSync(dirPath);
  } catch {
    // Cleanup is best-effort: never mask the error that aborted the command.
  }
}

/**
 * The `--name` value, validated like the wizard's answer: kebab-case, since the name becomes a
 * Docker project and npm package name. `undefined` means "derive it from the folder".
 */
function projectNameOption(rawName: unknown): string | undefined {
  if (rawName === undefined) return undefined;
  const name = String(rawName).trim();
  const result = validateProjectName(name);
  if (!result.valid) {
    throw new FliskError(result.error ?? "Invalid project name", [
      "Set --name to a Docker- and npm-compatible name (lowercase letters, numbers, and hyphens only)",
    ]);
  }
  return name;
}

export const projectCommand = addYesOption(new Command("project"))
  .alias("init")
  .description("Initialize or validate project-level master configuration")
  .argument(
    "[template]",
    `Clone a starter example instead of a blank project (${Object.keys(PROJECT_TEMPLATES).join(", ")})`,
  )
  .option(
    "--path <dir>",
    "Directory to create the project in (with a template: the clone destination; without one: the blank project directory)",
  )
  .option(
    "--name <name>",
    "Project name for a new project (default: the folder's name, made Docker- and npm-compatible)",
  )
  .option("--check", "Check if master configs exist and are in sync")
  .option("--force", "Overwrite existing configuration (dangerous)")
  .option("--config-file <path>", "Load project config from existing JSON file")
  .option("-q, --quiet", "Only print what fails; used by `flisk demo`", false)
  .option(
    "--no-agent-skills",
    "Do not write the Flisk agent skills (.claude/skills, .agents/skills) and AGENTS.md",
  )
  .option(
    "--list",
    "List the starter templates (key, repo, description, needs, pinned ref); with --json, the usual envelope with them in data.templates",
    false,
  )
  .option("--json", "Print one JSON envelope on stdout; implies --yes and --quiet", false)
  .addHelpText(
    "after",
    "\nExamples:\n  flisk project\n  flisk project demo\n  flisk project --check",
  )
  .action(async (template, options) => {
    const json = Boolean(options.json);
    if (options.list) {
      printTemplateCatalog(json);
      return;
    }
    // --json never prompts and prints no progress: it takes the defaults --yes takes.
    const yes = Boolean(options.yes || json);
    const quiet = Boolean(options.quiet || json);
    const { assertMachineReadyOrExit, detectRuntimePrerequisites, formatRuntimeNextSteps } =
      await import("../utils/cold-preflight.js");
    const action = async (): Promise<JsonCommandResult> => {
      const requestedName = projectNameOption(options.name);
      // Project setup only writes files: it must not need a running Docker daemon
      // or an installed Tilt. The runtime is checked on `flisk up`.
      await assertMachineReadyOrExit({ scope: "scaffold" });
      const runtime = detectRuntimePrerequisites();
      const runtimeNextSteps = formatRuntimeNextSteps(runtime);
      if (template) {
        if (requestedName !== undefined) {
          throw new FliskError("`--name` applies to a blank project, not a template clone", [
            "Pick the clone's folder with --path; the clone names its project after it",
            "Or drop --name",
          ]);
        }
        if (json && !Object.hasOwn(PROJECT_TEMPLATES, template)) {
          const actionHint = actionWordHint(template);
          throw new FliskError(`Unknown template: "${template}"`, [
            ...(actionHint ? [`Did you mean "${actionHint}"?`] : []),
            `Use one of: ${Object.keys(PROJECT_TEMPLATES).join(", ")}`,
            "Or run `flisk project` with no template for a blank project",
          ]);
        }
        const destination = await cloneProjectTemplate(template, options.path, runtimeNextSteps, {
          quiet,
        });
        // A re-scaffold writes a new random DB_PASSWORD when `flisk up` completes the project, but
        // Postgres keeps the password of an old data volume and then rejects the migrator (#3983).
        const cleanup = cleanStaleVolumesForScaffold(destination);
        if (!quiet && cleanup.removed.length > 0) {
          showDetail(
            `Removed stale Docker volumes from an earlier project of this name: ${cleanup.removed.join(", ")}`,
            0,
          );
        }
        return { data: { action: "cloned", template, path: destination, runtime } };
      }
      return initializeProject(runtime, runtimeNextSteps, requestedName);
    };

    const initializeProject = async (
      runtime: RuntimePrerequisiteStatus,
      runtimeNextSteps: string[],
      requestedName: string | undefined,
    ): Promise<JsonCommandResult> => {
      // --path also applies to a blank project (#5035): with no template it used
      // to be silently ignored and the project was always initialised in the
      // current directory (or the enclosing project). Resolve it the same way
      // the template clone does: absolute as-is, relative against the current
      // directory. The directory is created below by ensureDirectory(.flisk).
      const requestedPath = options.path
        ? isAbsolute(options.path)
          ? options.path
          : resolve(cwd(), options.path)
        : undefined;
      let projectRoot = requestedPath ?? findProjectRoot();

      if (!projectRoot) {
        projectRoot = cwd();
      }

      // A blank project is initialised when no project exists at the resolved
      // root, whether that root came from --path or from discovery.
      if (!existsSync(join(projectRoot, ".flisk", PROJECT_JSON)) && !quiet) {
        // --check only reports, so it must not claim a project is being created.
        showStep(
          options.check
            ? "Checking the Flisk project configuration...\n"
            : "🚀 Initializing new Flisk project...\n",
        );
        showDetail(`Location: ${projectRoot}\n`, 0);
      }

      const fliskDir = join(projectRoot, ".flisk");
      const projectJsonPath = join(fliskDir, PROJECT_JSON);

      if (options.check) {
        if (requestedName !== undefined) {
          throw new FliskError("`--name` does not apply to `--check`, which only reports", [
            "Drop --check to create the project with that name",
          ]);
        }
        // Recovery commands must point at the same destination the user
        // selected: without --path they would initialise or regenerate the
        // caller's project instead of the checked one (#5035).
        const pathArg = options.path ? ` --path ${shellQuote(options.path)}` : "";
        const allFilesExist = MASTER_CONFIG_FILES.every((f) =>
          existsSync(join(projectRoot, ".flisk", ".flisk-out", f)),
        );
        const projectJsonExists = existsSync(projectJsonPath);

        if (json) {
          const valid = allFilesExist && projectJsonExists;
          return {
            data: {
              action: "check",
              projectRoot,
              valid,
              hasProjectJson: projectJsonExists,
              missingFiles: MASTER_CONFIG_FILES.filter(
                (f) => !existsSync(join(projectRoot, ".flisk", ".flisk-out", f)),
              ),
            },
            errors: valid
              ? []
              : [
                  {
                    code: "PROJECT_INCOMPLETE",
                    message: "Project configuration incomplete",
                    suggestions: [
                      `Run \`flisk project --yes${pathArg}\` to create the missing files`,
                    ],
                  },
                ],
            exitCode: valid ? 0 : 1,
          };
        }

        if (allFilesExist && projectJsonExists) {
          const projectConfig = readProjectConfig(projectRoot);
          showSuccess("Project configuration is valid");
          showDetail(`Project: ${projectConfig.project.name}`, 3);
          showDetail(`Phases: ${Object.keys(projectConfig.phases).join(", ")}`, 3);
          process.exit(0);
        } else {
          console.log(chalk.yellow("⚠️  Project configuration incomplete:"));
          if (!projectJsonExists) showDetail(".flisk/project.json (not found)", 3);
          if (!allFilesExist) {
            for (const f of MASTER_CONFIG_FILES.filter(
              (f) => !existsSync(join(projectRoot, ".flisk/.flisk-out", f)),
            )) {
              showDetail(`.flisk/.flisk-out/${f} (not found)`, 3);
            }
          }
          showDetail(`Run \`flisk project${pathArg}\` to create them.`);
          process.exit(1);
        }
      }

      // Refuse a broken user-owned manifest or a conflicting file before the first write, so a failed
      // project command never leaves .flisk/, generated Tilt configs or a root package.json behind (#5419).
      preflightProjectFolder(projectRoot);

      if (!quiet) {
        showCommandHeader("Project Configuration");
        showDetail(`Project root: ${projectRoot}\n`, 0);
      }

      let createdFliskDir = false;
      if (!existsSync(fliskDir)) {
        ensureDirectory(fliskDir);
        createdFliskDir = true;
        if (!quiet) showSuccess("Created: .flisk/ directory");
      }

      const projectJsonExists = existsSync(projectJsonPath);
      const projectJsonBefore = projectJsonExists ? readFileSync(projectJsonPath, "utf-8") : null;

      if (projectJsonExists && !options.force) {
        if (!quiet) showSuccess(".flisk/project.json exists");
        const rawProjectConfig = JSON.parse(projectJsonBefore ?? "") as Record<string, unknown>;
        const projectConfig = readProjectConfig(projectRoot);
        // A refresh never renames: --name equal to the current one is a no-op (an idempotent
        // re-run stays fine), while a different one is refused rather than silently dropped.
        if (requestedName !== undefined && requestedName !== projectConfig.project.name) {
          throw new FliskError(
            `--name cannot rename the existing project "${projectConfig.project.name}"`,
            [
              "Edit project.name in .flisk/project.json, then run `flisk config regenerate`",
              "Or recreate with `flisk project --force --name <name> --yes` (resets discovery paths, enabled stacks and version; saves project.json.bak)",
            ],
          );
        }
        const discoveredStacks = discoverExistingServiceStacks(projectRoot);
        const autoEnabledStacks = syncDiscoveredStacksToPreAlpha(projectConfig, discoveredStacks);
        const shouldRewriteProjectConfig = autoEnabledStacks.length > 0 || !rawProjectConfig.phases;

        if (shouldRewriteProjectConfig) {
          writeTextFileAtomic(projectJsonPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
        }

        if (autoEnabledStacks.length > 0 && !quiet) {
          showDetail(`Auto-enabled discovered service stacks: ${autoEnabledStacks.join(", ")}`, 0);
        }

        if (!quiet) showStep("\n📋 Regenerating master configuration files...\n");

        await generateMasterConfigs(projectRoot, { quiet });
        const env = {
          created: ensureEnvFile(projectRoot, envKeyOptions(projectRoot)),
          added: [] as string[],
        };
        if (env.created) {
          if (!quiet) showSuccess("Created: .env (the defaults work as-is)");
        } else {
          env.added = completeEnvFile(projectRoot, envKeyOptions(projectRoot));
          if (env.added.length > 0 && !quiet) {
            showSuccess(`Updated: .env (added ${env.added.join(", ")}; existing values unchanged)`);
          }
        }
        const ignored = ensureGitignore(projectRoot);
        if (ignored.length > 0 && !quiet) {
          showSuccess(`Added to .gitignore: ${ignored.join(", ")}`);
        }
        if (!quiet) {
          console.log(chalk.green("\n✅ Project configuration regenerated!"));
          showDetail("\nGenerated in .flisk/.flisk-out/:", 0);
          for (const file of MASTER_CONFIG_FILES) {
            showDetail(`- ${file}`);
          }
          showDetail("\nRuntime readiness:", 0);
          for (const line of runtimeNextSteps) showDetail(line, 0);
        }
        return {
          data: {
            action: "regenerated",
            projectRoot,
            autoEnabledStacks,
            generatedFiles: [...MASTER_CONFIG_FILES],
            env,
            gitignoreAdded: ignored,
            runtime,
          },
        };
      }

      if (projectJsonExists && options.force && !yes) {
        console.log(chalk.red("\n⚠️  WARNING: --force will overwrite .flisk/project.json!"));
        console.log(
          chalk.yellow("The old file is saved to project.json.bak and every reset key is listed."),
        );
        const confirm = await promptConfirm({
          message:
            "This will reset your project configuration (discovery paths, stacks and version); a backup is saved. Continue?",
          initial: false,
        });
        if (!confirm) {
          showCancelled();
          return { data: null };
        }
      }

      let projectConfig: ProjectConfig;
      let autoEnabledStacks: string[] = [];
      let forceBackup: string | null = null;
      let forceResetKeys: string[] = [];
      const discoveredStacks = discoverExistingServiceStacks(projectRoot);

      try {
        if (options.configFile) {
          if (requestedName !== undefined) {
            throw new FliskError("`--name` cannot be combined with `--config-file`", [
              "Set project.name in the config file, or drop --config-file",
            ]);
          }
          const configFilePath = resolve(options.configFile);
          if (!existsSync(configFilePath)) {
            throw new FliskError(`Config file not found: ${configFilePath}`, [
              "Pass the path of an existing project.json to --config-file",
              "Or drop --config-file to use the defaults",
            ]);
          }
          const configContent = readFileSync(configFilePath, "utf-8");
          projectConfig = JSON.parse(configContent);
          if (typeof projectConfig?.project?.name === "string") {
            const nameResult = validateProjectName(projectConfig.project.name.trim());
            if (!nameResult.valid) {
              throw new FliskError(nameResult.error ?? "Invalid project name", [
                "Set project.name in the config file to a Docker- and npm-compatible name (lowercase letters, numbers, and hyphens only)",
              ]);
            }
            projectConfig.project.name = projectConfig.project.name.trim();
          }
          if (!quiet) showSuccess(`Loaded config from: ${configFilePath}`);
        } else if (yes) {
          projectConfig = JSON.parse(JSON.stringify(DEFAULT_PROJECT_JSON));
          projectConfig.project.name =
            requestedName ?? deriveProjectName(basename(projectRoot), projectRoot);
          if (!quiet) console.log(chalk.gray("Using default configuration (non-interactive mode)"));
        } else {
          showStep("📝 Project Setup Wizard\n");

          // --name answers the name question, so the wizard skips it.
          const projectName =
            requestedName ??
            (await promptText({
              message: "Project name:",
              initial: deriveProjectName(basename(projectRoot), projectRoot),
              validate: (input: string) => {
                const result = validateProjectName(input.trim());
                return result.valid ? true : (result.error ?? "Project name is required");
              },
            }));
          const projectVersion = await promptText({
            message: "Project version:",
            initial: "1.0.0-alpha",
          });
          const corePreAlphaFeatures = Object.values(PROJECT_FEATURES).filter(
            (f) => f.category === "core" && f.phase === "pre_alpha",
          );
          const corePreAlphaNames = new Set(corePreAlphaFeatures.map((f) => f.name));
          const preAlphaStacks = await promptMultiSelect({
            message: "Select Pre-Alpha enabled stacks (core infrastructure):",
            choices: [
              ...corePreAlphaFeatures.map((f) => ({
                title: f.description,
                value: f.name,
                selected: f.enabled_by_default,
              })),
              // Exclude discovered stacks that duplicate a core feature name (e.g. a
              // "database-management" service dir) - otherwise the same value shows
              // up as two checked boxes and accepting defaults writes it twice into
              // project.json, which the generator later emits as a duplicate
              // Starlark dict key and Tilt refuses to parse.
              ...discoveredStacks
                .filter((stack) => !corePreAlphaNames.has(stack))
                .map((stack) => ({
                  title: `${stack} (discovered service stack)`,
                  value: stack,
                  selected: true,
                })),
            ],
          });
          const alphaStacks = await promptMultiSelect({
            message: "Select Alpha enabled stacks (core business):",
            choices: [
              { title: "api (Backend API)", value: "api" },
              { title: "app (Frontend app)", value: "app" },
            ],
          });
          const betaStacks = await promptMultiSelect({
            message: "Select Beta enabled stacks (extended features):",
            choices: [
              { title: "worker (Background jobs)", value: "worker" },
              { title: "migrator (Database migrations)", value: "migrator" },
            ],
          });
          const optionalInfra = await promptMultiSelect({
            message: "Enable optional infrastructure (high resource):",
            choices: Object.values(PROJECT_FEATURES)
              .filter((f) => f.category === "optional")
              .concat(Object.values(PROJECT_FEATURES).filter((f) => f.category === "premium"))
              .map((f) => ({
                title: f.description,
                value: f.name,
                selected: f.enabled_by_default,
              })),
          });

          showStep("\n📂 Service discovery");
          showDetail("What: folder patterns Flisk scans for a service.json in each match.");
          showDetail("Where: type one or more globs, comma-separated.");
          showDetail("How: saved as discovery.paths in .flisk/project.json - editable later.");
          showDetail(`Example: ${DEFAULT_PROJECT_JSON.discovery.paths.join(", ")}\n`);

          const discoveryPaths = await promptText({
            message: "Folders to scan:",
            initial: DEFAULT_PROJECT_JSON.discovery.paths.join(", "),
          });

          projectConfig = JSON.parse(JSON.stringify(DEFAULT_PROJECT_JSON));
          projectConfig.project.name = projectName;
          projectConfig.project.version = projectVersion;
          projectConfig.phases.pre_alpha.enabledStacks = Array.from(new Set(preAlphaStacks));
          projectConfig.phases.alpha.enabledStacks = Array.from(new Set(alphaStacks));
          projectConfig.phases.beta.enabledStacks = Array.from(new Set(betaStacks));
          projectConfig.optional_infra.monitoring = optionalInfra.includes("monitoring");
          projectConfig.optional_infra.elk = optionalInfra.includes("elk");
          projectConfig.optional_infra.debezium = optionalInfra.includes("debezium");
          projectConfig.optional_infra.golden_image = optionalInfra.includes("golden_image");
          projectConfig.optional_infra.verdaccio = optionalInfra.includes("verdaccio");
          const parsedDiscoveryPaths = discoveryPaths
            .split(",")
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);
          projectConfig.discovery.paths =
            parsedDiscoveryPaths.length > 0
              ? parsedDiscoveryPaths
              : DEFAULT_PROJECT_JSON.discovery.paths;
        }

        // A --config-file without `phases` makes this throw, so it stays inside the cleanup too.
        autoEnabledStacks = syncDiscoveredStacksToPreAlpha(projectConfig, discoveredStacks);
        if (autoEnabledStacks.length > 0 && !quiet) {
          showDetail(`Auto-enabled discovered service stacks: ${autoEnabledStacks.join(", ")}`, 0);
        }

        if (projectJsonBefore !== null && options.force) {
          forceBackup = backupProjectJson(projectJsonPath, projectJsonBefore);
          let changes: ReturnType<typeof projectConfigChanges> = [];
          try {
            changes = projectConfigChanges(JSON.parse(projectJsonBefore), projectConfig);
          } catch {
            // A corrupt project.json is still backed up; --force replaces it as before.
          }
          forceResetKeys = changes.map((change) => change.path);
          if (!quiet) {
            console.log(
              chalk.yellow(
                changes.length > 0
                  ? `\n⚠️  --force reset ${changes.length} ${changes.length === 1 ? "key" : "keys"} in .flisk/project.json:`
                  : "\n--force left every project.json key unchanged.",
              ),
            );
            for (const line of formatProjectConfigChanges(changes)) showDetail(line, 1);
            showDetail(`Saved the previous file to ${forceBackup}`, 1);
          }
        }

        if (!quiet) showStep("\n📋 Creating project configuration...\n");
        writeTextFileAtomic(projectJsonPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
      } catch (error) {
        // Only an empty directory this run created is removed; a partial write leaves it non-empty and stays.
        if (createdFliskDir) removeEmptyCreatedDirectory(fliskDir);
        throw error;
      }
      if (!quiet) {
        showSuccess("Created: .flisk/project.json");
        showDetail(`→ Project: ${projectConfig.project.name}`);
        showStep("\n📋 Generating master configuration files...\n");
      }
      await generateMasterConfigs(projectRoot, { quiet });

      if (!quiet) showStep("\n🔧 Setting up environment variables...\n");
      const env = {
        created: ensureEnvFile(projectRoot, envKeyOptions(projectRoot)),
        added: [] as string[],
      };
      if (env.created) {
        if (!quiet) showSuccess("Created: .env (the defaults work as-is)");
      } else {
        // An .env from an older CLI lacks keys a newer one expects; add them without changing anything already there.
        env.added = completeEnvFile(projectRoot, envKeyOptions(projectRoot));
        if (env.added.length > 0) {
          if (!quiet) {
            showSuccess(`Updated: .env (added ${env.added.join(", ")}; existing values unchanged)`);
          }
        } else if (!quiet) {
          showSuccess("Found: .env (environment already configured)");
        }
      }

      const envValidation = validateEnvFile(projectRoot, envKeyOptions(projectRoot));
      if (envValidation.missing.length > 0) {
        console.log(chalk.yellow("\n⚠️  Missing required environment variables:"));
        for (const missing of envValidation.missing) {
          showDetail(`- ${missing}`, 1);
        }
        showDetail("→ Edit .env and fill in these values before running `flisk up`", 1);
      }

      const ignored = ensureGitignore(projectRoot);
      if (ignored.length > 0 && !quiet) {
        showSuccess(`Added to .gitignore: ${ignored.join(", ")}`);
      }

      // A coding agent opened in the project then knows to build and run the app with Flisk.
      // The project works without them, so a failure here is a warning, not an exit.
      let skillFiles: string[] = [];
      const warnings: string[] = [];
      if (options.agentSkills !== false) {
        const guardNeedsWiring = claudeGuardHookNeedsWiring(projectRoot);
        try {
          const canonicalRoot = realpathSync(projectRoot);
          const gitRoot = findGitWorkTreeRoot(canonicalRoot);
          const nested = gitRoot !== null && gitRoot !== canonicalRoot;
          if (nested) {
            const subdirectory = relative(gitRoot, canonicalRoot).split("\\").join("/");
            const warning =
              `CI workflow skipped: GitHub only reads workflows at the Git root (${gitRoot}). ` +
              `Add CI there with working-directory set to ${JSON.stringify(subdirectory)}. ` +
              "Existing workflow files are left unchanged.";
            warnings.push(warning);
            if (!quiet) showDetail(warning, 0);
          }
          skillFiles = installAgentSkills(projectRoot, { ciWorkflow: !nested });
          if (skillFiles.length > 0 && !quiet) {
            showSuccess(
              "Added agent skills: .claude/skills, .agents/skills and AGENTS.md (start with flisk-build)",
            );
          }
          if (guardNeedsWiring && !quiet) {
            const hooks = (JSON.parse(PROJECT_CLAUDE_SETTINGS) as { hooks: unknown }).hooks;
            console.log(
              chalk.yellow(
                `⚠️  Existing .claude/settings.json does not run the Flisk generated-file guard; Flisk did not write the hook script. Add this hooks block to enable it:\n${JSON.stringify(hooks, null, 2)}`,
              ),
            );
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.log(chalk.yellow(`⚠️  Could not add the agent skills: ${reason}`));
        }
      }

      if (!quiet) {
        console.log(chalk.green("\n✅ Project configuration complete!"));
        showDetail("\nGenerated files in .flisk/.flisk-out/:", 0);
        for (const file of MASTER_CONFIG_FILES) {
          showDetail(`- ${file}`);
        }
        showDetail("\nEnvironment configuration:", 0);
        showDetail("- .env (contains all required variables)");
        showDetail("\nSource file:", 0);
        showDetail("- .flisk/project.json (edit this to change project structure)");
        showDetail("\nNext steps:", 0);
        // The next steps run inside the new project, not the caller's directory:
        // when --path put the project elsewhere (#5035), print the cd step first,
        // reusing the template path's shell-aware formatting. Unchanged when the
        // project is in the current directory.
        if (projectRoot !== cwd()) {
          const { cdCommands } = formatProjectPaths(projectRoot);
          const [first, ...rest] = cdCommands;
          showDetail(`1. ${first}`);
          for (const alt of rest) showDetail(`   ${alt}`);
          showDetail(
            `2. flisk resource api --type backend --stack ${DEFAULT_STACK_NAME}   # scaffold a service`,
          );
          showDetail(
            `3. flisk up ${DEFAULT_STACK_NAME}                                     # start it`,
          );
        } else {
          showDetail(
            `1. flisk resource api --type backend --stack ${DEFAULT_STACK_NAME}   # scaffold a service`,
          );
          showDetail(
            `2. flisk up ${DEFAULT_STACK_NAME}                                     # start it`,
          );
        }
        showDetail("\nRuntime readiness:", 0);
        for (const line of runtimeNextSteps) showDetail(line, 0);
        showDetail("\nAfter editing .flisk/project.json, run `flisk config regenerate`.", 0);
      }
      return {
        data: {
          action: "created",
          projectRoot,
          projectName: projectConfig.project.name,
          forceBackup,
          forceResetKeys,
          autoEnabledStacks,
          generatedFiles: [...MASTER_CONFIG_FILES],
          env,
          missingEnv: envValidation.missing,
          gitignoreAdded: ignored,
          agentSkills: skillFiles,
          ...(warnings.length > 0 ? { warnings } : {}),
          runtime,
        },
      };
    };

    if (json) {
      await runJsonCommand("PROJECT_FAILED", "flisk project", action);
      return;
    }
    await runCommand(action);
  });
