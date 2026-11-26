import { Command } from "commander";
export { compareSemver, type ParsedSemver, parseSemver } from "../utils/semver.js";
export { buildForwardedImportArgs, IMPORT_PACKAGE, importInvocation, TILTFILE_IMPORTER, } from "./import/invocation.js";
export { type ImportPlan, type ImportPlannedService, type ImportPlannedWrite, type ImportPlanSkip, parseImportPlan, } from "./import/plan.js";
export type { ImportDirCheck, ImportOptions, ImportReport, ImportRun, TiltfileImportReport, } from "./import/run.js";
export { carryOverBuildCommand, checkImportDirArg, executeImport, importDirArg, importFailure, importReport, installImportAgentSkills, nonInteractiveRefusal, resolveImportOptions, runImport, runImportCaptured, syncImportedManifestCommands, } from "./import/run.js";
export type { SkippedImportSource } from "./import/skipped-sources.js";
export { findSkippedProcfiles, importTargetDir, skippedImportSources, skippedSourcesNotice, } from "./import/skipped-sources.js";
export type { CoverageFinding, ImportCoverage } from "./import/summary.js";
export { customNetworkNames, formatCoverageBlock, importCoverage, importCoverageSummary, importedFiles, networksFinding, } from "./import/summary.js";
export { checkCoreVersion, isVersionAtLeast, MIN_CORE_VERSION, RECOMMENDED_CORE_VERSION, } from "./import/version-gate.js";
export declare const composeCommand: Command;
/**
 * `flisk import tiltfile` registers an existing Tiltfile as the project's orchestration source. flisk-import (0.4.1 or later)
 * does the import, like `compose`; core only wraps the registered Tiltfile at `flisk up` (see wrappedTiltfilePath).
 */
export declare const tiltfileCommand: Command;
export declare const importCommand: Command;
