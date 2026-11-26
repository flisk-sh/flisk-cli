// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { addYesOption } from "../utils/command-helpers.js";
import { TILTFILE_IMPORTER } from "./import/invocation.js";
import { executeImport, type ImportOptions, resolveImportOptions } from "./import/run.js";

// Shared semver helpers (utils/semver.ts); re-exported so this module's public surface is unchanged.
export { compareSemver, type ParsedSemver, parseSemver } from "../utils/semver.js";
// Invocation contract: the pinned flisk-import package and the CLI flag bridge to it.
export {
  buildForwardedImportArgs,
  IMPORT_PACKAGE,
  importInvocation,
  TILTFILE_IMPORTER,
} from "./import/invocation.js";
// The importer's printed plan, parsed into the structured fields of an import --json report.
export {
  type ImportPlan,
  type ImportPlannedService,
  type ImportPlannedWrite,
  type ImportPlanSkip,
  parseImportPlan,
} from "./import/plan.js";
export type {
  ImportDirCheck,
  ImportOptions,
  ImportReport,
  ImportRun,
  TiltfileImportReport,
} from "./import/run.js";

// Execution and reporting.
export {
  carryOverBuildCommand,
  checkImportDirArg,
  executeImport,
  importDirArg,
  importFailure,
  importReport,
  installImportAgentSkills,
  nonInteractiveRefusal,
  resolveImportOptions,
  runImport,
  runImportCaptured,
  syncImportedManifestCommands,
} from "./import/run.js";
// Sibling sources the importer does not read (a Procfile next to the Compose file): detected and
// reported as skipped so the import does not drop them silently.
export type { SkippedImportSource } from "./import/skipped-sources.js";
export {
  findSkippedProcfiles,
  importTargetDir,
  skippedImportSources,
  skippedSourcesNotice,
} from "./import/skipped-sources.js";
export type { CoverageFinding, ImportCoverage } from "./import/summary.js";
// The coverage summary: what an import dropped, approximated or skipped by design.
export {
  customNetworkNames,
  formatCoverageBlock,
  importCoverage,
  importCoverageSummary,
  importedFiles,
  networksFinding,
} from "./import/summary.js";
// Version gate: the minimum core an import may write on.
export {
  checkCoreVersion,
  isVersionAtLeast,
  MIN_CORE_VERSION,
  RECOMMENDED_CORE_VERSION,
} from "./import/version-gate.js";

export const composeCommand = addYesOption(new Command("compose"))
  .description(
    "Import a directory's root docker-compose.yml, same as flisk import (runs flisk-import)",
  )
  .argument("[args...]", "Passed to flisk-import: [dir] --dry-run --yes --force")
  .option("-f, --force", "Overwrite an existing service.json", false)
  .option("--dry-run", "Print the plan and write nothing", false)
  .option(
    "--no-agent-skills",
    "Do not write the Flisk agent skills (.claude/skills, .agents/skills) and AGENTS.md",
  )
  .option(
    "--json",
    "Print one JSON envelope on stdout with the importer's output; implies --yes",
    false,
  )
  .allowUnknownOption()
  .helpOption(false)
  .action(async (args: string[], options: ImportOptions, cmd: Command) => {
    const resolved = resolveImportOptions(options, cmd);
    await executeImport(args, resolved, "flisk import compose");
  });

/**
 * `flisk import tiltfile` registers an existing Tiltfile as the project's orchestration source. flisk-import (0.4.1 or later)
 * does the import, like `compose`; core only wraps the registered Tiltfile at `flisk up` (see wrappedTiltfilePath).
 */
export const tiltfileCommand = addYesOption(new Command("tiltfile"))
  .description(
    "Register an existing Tiltfile so flisk up runs it unchanged (writes .flisk/project.json)",
  )
  .argument("[args...]", "Passed to flisk-import tiltfile: [path] --dry-run --yes --force")
  .option("-f, --force", "Overwrite existing orchestration configuration", false)
  .option("--dry-run", "Print the plan and write nothing", false)
  .option(
    "--json",
    "Print one JSON envelope on stdout with the importer's output; implies --yes",
    false,
  )
  .allowUnknownOption()
  .helpOption(false)
  .action(async (args: string[], options: ImportOptions, cmd: Command) => {
    const resolved = resolveImportOptions(options, cmd);
    await executeImport([TILTFILE_IMPORTER, ...args], resolved, "flisk import tiltfile");
  });

export const importCommand = addYesOption(new Command("import"))
  .description("Import the services in a directory's root docker-compose.yml (runs flisk-import)")
  .argument("[args...]", "Passed to flisk-import: [dir] --dry-run --yes --force")
  .option("-f, --force", "Overwrite an existing service.json", false)
  .option("--dry-run", "Print the plan and write nothing", false)
  .option(
    "--no-agent-skills",
    "Do not write the Flisk agent skills (.claude/skills, .agents/skills) and AGENTS.md",
  )
  .option(
    "--json",
    "Print one JSON envelope on stdout with the importer's output; implies --yes",
    false,
  )
  .allowUnknownOption()
  .helpOption(false)
  .addCommand(composeCommand)
  .addCommand(tiltfileCommand)
  .action(async (args: string[], options: ImportOptions, cmd: Command) => {
    const resolved = resolveImportOptions(options, cmd);
    await executeImport(args, resolved, "flisk import");
  });
