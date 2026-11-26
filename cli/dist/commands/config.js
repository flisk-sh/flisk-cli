// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { readProjectConfig, VERIFY_DIFF_LINE_LIMIT, verifyMasterConfigs, } from "../generator/template-engine.js";
import { claudeGuardHookIsOrphaned } from "../utils/agent-skills.js";
import { getCheckoutIdentity } from "../utils/checkout-id.js";
import { handleDryRun } from "../utils/command-helpers.js";
import { explainConfigFile } from "../utils/config-explain.js";
import { applyMigrationPlan, buildMigrationPlan } from "../utils/config-migrate.js";
import { PROJECT_JSON } from "../utils/constants.js";
import { clearDiscoveryCache } from "../utils/discovery-context.js";
import { checkDuplicateResourceNames, checkDuplicateResourcePorts, checkPrismaConsistency, } from "../utils/doctor-wiring.js";
import { errorFactories, FliskError, requireProjectRoot, runCommand, showError, } from "../utils/errors.js";
import { enforceFliskVersionGate } from "../utils/flisk-version-gate.js";
import { runJsonCommand } from "../utils/json-command.js";
import { createMachineEnvelope, writeMachineError } from "../utils/machine-output.js";
import { isNativeProject } from "../utils/native-service.js";
import { findProjectRoot } from "../utils/paths.js";
import { addProjectOption } from "../utils/project-resolution.js";
import { checkCircularDependencies, checkDependsOnShape, checkDockerfilePorts, checkServicePorts, postgresVolumeWarnings, unsetEnvReferences, unsetEnvWarning, } from "../utils/service-config-checks.js";
import { applyServiceLocalOverrides } from "../utils/service-local-overrides.js";
import { SERVICE_MANIFEST_SCHEMA_VERSION } from "../utils/service-manifest.js";
import { discoverResourcesWithProblems, warnAboutSkippedFiles } from "../utils/services.js";
import { describeSharedPostgresUsers, evaluateSharedPlatformPostgres, } from "../utils/shared-platform-postgres.js";
import { infraToggleCommand } from "./config/infra-toggle.js";
import { regenerateAction } from "./config/regenerate-action.js";
export { regeneratePlan } from "./config/plan.js";
/** Repeatable `--diff <file>`: opt in to a capped diff for one drifted file at a time. */
function collectDiffFiles(value, previous) {
    return [...(previous ?? []), value];
}
/** Human wording for `flisk config explain`, one line per drift outcome. */
const DRIFT_LABELS = {
    "blocks-up": "yes, until the edit is removed or --ignore-drift is passed",
    none: "no",
    unknown: "unknown",
};
export const configCommand = addProjectOption(new Command("config"), "config")
    .description("Manage project configuration and regenerate master files")
    .addCommand(new Command("regenerate")
    .description("Regenerate all 4 master config files from .flisk/project.json")
    .option("--dry-run", "Show what would change without writing files")
    .option("--ignore-version", "Continue even if the CLI does not match the project's version requirements", false)
    .option("--json", "Print one JSON envelope on stdout with each master file's change (new, modified, unchanged)", false)
    .addHelpText("after", `\nExamples:\n  flisk config regenerate\n  flisk config regenerate --dry-run\n  flisk config regenerate --json`)
    .action(regenerateAction))
    .addCommand(new Command("migrate")
    .description("Migrate service.json files to the current schema version")
    .option("--ignore-version", "Continue even if the CLI does not match the project's version requirements", false)
    .option("--dry-run", "List the service.json files that would be rewritten, without writing", false)
    .option("--json", "Print one JSON envelope on stdout with the migrated files", false)
    .addHelpText("after", `\nExamples:\n  flisk config migrate\n  flisk config migrate --dry-run\n  flisk config migrate --json`)
    .action(async (options) => {
    const action = async () => {
        const projectRoot = options.json ? findProjectRoot() : requireProjectRoot();
        if (!projectRoot)
            throw errorFactories.notInProject();
        enforceFliskVersionGate(projectRoot, {
            ignoreVersion: options.ignoreVersion,
            json: options.json,
        });
        // One read-only plan feeds both the dry run and the real run, so their file lists agree.
        const plan = buildMigrationPlan(projectRoot);
        const files = plan.pending.map(({ filePath }) => relative(projectRoot, filePath).split(sep).join("/"));
        const report = (dryRun) => ({
            data: {
                dryRun,
                schemaVersion: SERVICE_MANIFEST_SCHEMA_VERSION,
                migrated: files,
                warnings: plan.warnings,
            },
        });
        // Nothing is written when one file fails, so a failed run leaves every service.json as it was.
        if (options.json && plan.failures.length > 0) {
            return {
                data: null,
                errors: plan.failures.map((message) => ({
                    code: "MIGRATE_FAILED",
                    message,
                    suggestions: ["Fix the file, then run `flisk config migrate` again"],
                })),
                exitCode: 1,
            };
        }
        for (const failure of plan.failures)
            showError(failure);
        if (plan.failures.length > 0)
            process.exit(1);
        for (const warning of plan.warnings) {
            console.warn(chalk.yellow(`⚠️  ${warning}`));
        }
        if (handleDryRun(options, `${plan.pending.length} service.json file${plan.pending.length === 1 ? "" : "s"} to schema version ${SERVICE_MANIFEST_SCHEMA_VERSION}`, "flisk config migrate")) {
            for (const file of files)
                console.log(`Would rewrite: ${file}`);
            if (files.length === 0)
                console.log("Nothing to migrate.");
            console.log("No files were written.");
            return report(true);
        }
        applyMigrationPlan(plan);
        if (plan.pending.length > 0) {
            clearDiscoveryCache();
        }
        const migrated = plan.pending.length;
        if (migrated === 0) {
            console.log(chalk.green(`All ${plan.totalFiles} service.json files are already on schema version ${SERVICE_MANIFEST_SCHEMA_VERSION}. Nothing to migrate.`));
        }
        else {
            console.log(chalk.green(`✅ Migrated ${migrated} service.json file${migrated === 1 ? "" : "s"} to schema version ${SERVICE_MANIFEST_SCHEMA_VERSION}.`));
            console.log(chalk.yellow("Review the diff; unknown fields were preserved."));
        }
        return report(false);
    };
    if (options.json) {
        await runJsonCommand("MIGRATE_FAILED", "flisk config migrate", action);
        return;
    }
    await runCommand(action);
}))
    .addCommand(new Command("verify")
    .description("Verify that generated files match .flisk/project.json")
    .option("--ignore-version", "Continue even if the CLI does not match the project's version requirements", false)
    .option("--json", "Emit a machine-readable verification report")
    .option("--diff <file>", `Include a capped diff for this reported file (repeatable, max ${VERIFY_DIFF_LINE_LIMIT} lines per file)`, collectDiffFiles)
    .addHelpText("after", `\nExamples:\n  flisk config verify\n  flisk config verify --json\n  flisk config verify --diff Tiltfile --json`)
    .action(async (options) => {
    const action = async () => {
        const projectRoot = options.json ? findProjectRoot() : requireProjectRoot();
        if (!projectRoot)
            throw errorFactories.notInProject();
        enforceFliskVersionGate(projectRoot, {
            ignoreVersion: options.ignoreVersion,
            json: options.json,
        });
        const { resources, problems } = discoverResourcesWithProblems(projectRoot);
        warnAboutSkippedFiles(problems);
        // Reporting only: verify never applies these fields to generated files. A malformed local file is a
        // machine-local problem, so it must not stop verification of the committed configuration. Text
        // verification never inspects local files at all.
        let overrides = [];
        let overrideErrors = [];
        if (options.json) {
            try {
                // Per file: one malformed local file must not hide another service's valid override, and every
                // malformed file is named, not only the first.
                const applied = applyServiceLocalOverrides(resources, { skipInvalidFiles: true });
                overrides = applied.overrides;
                overrideErrors = applied.invalidFiles;
            }
            catch (error) {
                overrideErrors = [error instanceof Error ? error.message : String(error)];
            }
        }
        const manifestPaths = [
            ...resources.map((r) => r.configPath),
            ...problems.map((p) => p.path),
        ];
        const verified = verifyMasterConfigs(projectRoot, {
            manifestPaths,
            diffFiles: options.diff ?? [],
        });
        // Warnings only: Postgres 18+ with a volume at the pre-18 path is valid config that will not start, and two
        // routed resources on one port still run (each in its own container) but is usually a copied service.json.
        // A `${VAR}` with no default unset in .env and the shell interpolates to an empty value, so the service
        // starts broken with the cause only in its log (#3104); it is listed, never its would-be value.
        const duplicatePorts = checkDuplicateResourcePorts(projectRoot, resources);
        const unsetEnvRefs = unsetEnvReferences(projectRoot, resources);
        const result = {
            ...verified,
            warnings: [
                ...verified.warnings,
                ...postgresVolumeWarnings(projectRoot, resources),
                ...(duplicatePorts.didPass
                    ? []
                    : [`${duplicatePorts.message}\n    Fix: ${duplicatePorts.fix}`]),
                ...unsetEnvRefs.map(unsetEnvWarning),
                ...(claudeGuardHookIsOrphaned(projectRoot)
                    ? [
                        ".claude/hooks/flisk-generated-guard.mjs exists but .claude/settings.json does not run it; add the hooks.PreToolUse entry from `flisk project` or delete the orphan script",
                    ]
                    : []),
            ],
        };
        // Same predicate as flisk doctor's Shared platform Postgres check.
        const sharedPostgres = evaluateSharedPlatformPostgres(projectRoot, resources);
        const prismaConsistency = checkPrismaConsistency(projectRoot, resources);
        // A duplicate appName, a wrong-typed dependsOn, a circular dependsOn and an invalid port are what `flisk up` refuses,
        // so verify says the same.
        const graphErrors = [
            checkDuplicateResourceNames(projectRoot, resources),
            checkDependsOnShape(projectRoot, resources),
            checkCircularDependencies(projectRoot, resources),
            checkServicePorts(projectRoot, resources),
            checkDockerfilePorts(projectRoot, resources),
        ]
            .filter((check) => !check.didPass)
            .map((check) => check.fix ? `${check.message}\n    Fix: ${check.fix}` : check.message);
        const sharedPostgresErrors = [
            ...graphErrors,
            ...sharedPostgres.unknownDependsOnNames.map(({ resource, name }) => `dependsOn "${name}" on ${resource} is not a known service or stack (shared platform Postgres names are postgres and database-management)`),
        ];
        if (options.json) {
            console.log(JSON.stringify(createMachineEnvelope({
                valid: result.valid && sharedPostgresErrors.length === 0 && prismaConsistency.didPass,
                checkout: getCheckoutIdentity(projectRoot),
                errors: [
                    ...result.errors,
                    ...sharedPostgresErrors,
                    ...(prismaConsistency.didPass ? [] : [prismaConsistency.message]),
                ],
                warnings: result.warnings,
                diffs: result.diffs,
                diffLineLimit: result.diffLineLimit,
                state: result.state,
                overrides,
                // Separate from `errors`: a bad service.local.json does not invalidate generated files.
                overrideErrors,
                sharedPlatformPostgres: sharedPostgres,
                unsetEnvReferences: unsetEnvRefs,
            })));
            if (!result.valid || sharedPostgresErrors.length > 0 || !prismaConsistency.didPass)
                process.exit(1);
            return;
        }
        console.log(chalk.blue("🔍 Verifying configuration...\n"));
        for (const warning of result.warnings) {
            console.warn(chalk.yellow(`⚠️  ${warning}`));
        }
        for (const error of sharedPostgresErrors) {
            showError(error);
        }
        if (!prismaConsistency.didPass)
            showError(prismaConsistency.message);
        if (!isNativeProject(resources) && sharedPostgres.willStart) {
            // Project resource set (discoverResourcesFromRoot), not a flisk up --only filter.
            // Feature-on alone is not new behavior — print gray so default projects are not noisy.
            // dependsOn is the reason Postgres starts when the feature is off — green.
            if (sharedPostgres.reason === "feature" && sharedPostgres.dependsOnUsers.length === 0) {
                const source = sharedPostgres.featureOnFromTiltfile || sharedPostgres.featureOnFromSpecMaster
                    ? " (generated Tiltfile/spec.master)"
                    : "";
                console.log(chalk.gray(`ℹ️  Postgres will start because database-management is enabled${source} (project-wide; not a flisk up selection)`));
            }
            else if (sharedPostgres.reason === "feature") {
                console.log(chalk.yellow(`ℹ️  Postgres will start because database-management is enabled and ${describeSharedPostgresUsers(sharedPostgres)} (project resource set; flisk up may select a subset)`));
            }
            else {
                console.log(chalk.green(`ℹ️  Postgres will start because ${describeSharedPostgresUsers(sharedPostgres)} (project resource set; flisk up may select a subset)`));
            }
        }
        else if (!isNativeProject(resources) &&
            sharedPostgres.focusWouldEnableDatabaseManagement) {
            console.log(chalk.yellow("ℹ️  Postgres will not start from project.json/generated Tiltfile, but default focus/CORE_INFRA expansion would enable database-management on a typical flisk up"));
        }
        if (result.valid && sharedPostgresErrors.length === 0 && prismaConsistency.didPass) {
            console.log(chalk.green("✅ All files are in sync!"));
            return;
        }
        else {
            console.log(chalk.yellow("⚠️  Configuration issues found:"));
            for (const error of result.errors) {
                console.log(chalk.gray(`   - ${error}`));
            }
            for (const { diff } of result.diffs) {
                if (diff)
                    console.log(chalk.gray(`\n${diff}`));
            }
            const schemaErrors = result.errors.filter((error) => error.includes(".schemaVersion:"));
            if (schemaErrors.length > 0) {
                console.log(chalk.gray("\nRun `flisk config migrate` to fix schemaVersion."));
            }
            if (result.diffs.length > 0) {
                if (!options.diff?.length) {
                    console.log(chalk.gray(`\nRun \`flisk config verify --diff <file>\` to see one file's diff (max ${VERIFY_DIFF_LINE_LIMIT} lines).`));
                }
                console.log(chalk.gray("\nRun `flisk config regenerate` to fix generated files."));
            }
            process.exit(1);
        }
    };
    if (options.json) {
        try {
            await action();
        }
        catch (error) {
            writeMachineError(error);
        }
        return;
    }
    await runCommand(action);
}))
    .addCommand(new Command("explain")
    .description("Explain whether a project file is Flisk-generated and what editing it does on flisk up")
    .argument("<file>", "Project file to explain, relative to the current directory or absolute")
    .option("--json", "Emit a machine-readable explanation")
    .addHelpText("after", `\nExamples:\n  flisk config explain Tiltfile\n  flisk config explain services/orders-api/service.json\n  flisk config explain Tiltfile --json`)
    .showHelpAfterError("\nExplain a project file, for example: flisk config explain .flisk/project.json")
    .action(async (file, options) => {
    const action = async () => {
        const projectRoot = options.json ? findProjectRoot() : requireProjectRoot();
        if (!projectRoot)
            throw errorFactories.notInProject();
        const explanation = explainConfigFile(projectRoot, file);
        if (options.json) {
            console.log(JSON.stringify(createMachineEnvelope(explanation)));
            return;
        }
        console.log(chalk.blue(`${explanation.file}\n`));
        console.log(`  Ownership: ${explanation.ownership}`);
        console.log(`  ${explanation.reason}`);
        if (explanation.source)
            console.log(`  Source: ${explanation.source}`);
        console.log(`  Edited now: ${explanation.isEditedNow ? "yes" : "no"}`);
        console.log(`  Editing it blocks flisk up: ${DRIFT_LABELS[explanation.driftOnUp]}`);
        console.log(chalk.blue("\nNext:"));
        for (const step of explanation.next)
            console.log(chalk.gray(`  - ${step}`));
    };
    if (options.json) {
        try {
            await action();
        }
        catch (error) {
            writeMachineError(error);
        }
        return;
    }
    await runCommand(action);
}))
    .addCommand(new Command("edit").description("Open .flisk/project.json in your $EDITOR").action(async () => {
    await runCommand(async () => {
        const projectRoot = requireProjectRoot();
        const projectJsonPath = join(projectRoot, ".flisk", PROJECT_JSON);
        if (!existsSync(projectJsonPath)) {
            throw new FliskError(".flisk/project.json not found", [
                "Create the project config with: flisk project --yes",
            ]);
        }
        // A pipe, script or CI job cannot answer an editor, and vi would wait on the closed stdin.
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new FliskError("config edit needs a terminal; edit .flisk/project.json directly", [
                `Edit it in your own editor: ${projectJsonPath}`,
                "Then run `flisk config regenerate` to apply the changes.",
            ]);
        }
        // $VISUAL comes first, as in most editors; an unset or blank value falls through to $EDITOR.
        const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || "vi";
        console.log(chalk.blue(`Opening ${projectJsonPath} in ${editor}...`));
        // Split into a command and its arguments instead of handing the string to a shell.
        const editorParts = editor.split(/\s+/);
        const editorCmd = editorParts[0] || "vi";
        const editorArgs = [...editorParts.slice(1), projectJsonPath];
        const editorResult = spawnSync(editorCmd, editorArgs, { stdio: "inherit" });
        if (editorResult.error || editorResult.status !== 0) {
            throw new FliskError(`Editor "${editorCmd}" failed`, [
                editorResult.error?.message ??
                    (editorResult.signal
                        ? `Terminated by ${editorResult.signal}`
                        : `Exited with status ${editorResult.status ?? 1}`),
            ]);
        }
        try {
            readProjectConfig(projectRoot);
        }
        catch (error) {
            throw new FliskError("Editor saved an invalid .flisk/project.json", [
                "Fix .flisk/project.json before running `flisk config regenerate`.",
                error instanceof Error ? error.message : String(error),
            ]);
        }
        console.log(chalk.green("\n✅ Editor closed."));
        console.log(chalk.gray("Run `flisk config regenerate` to apply changes."));
    });
}));
configCommand
    .addCommand(infraToggleCommand("enable-infra", true))
    .addCommand(infraToggleCommand("disable-infra", false));
