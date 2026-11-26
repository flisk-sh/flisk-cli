// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { generateMasterConfigs, readProjectConfig, staleServiceOutputs, TemplateEngine, } from "../../generator/template-engine.js";
import { isMasterConfigFileName } from "../../types/index.js";
import { handleDryRun } from "../../utils/command-helpers.js";
import { MASTER_CONFIG_FILES, RESOURCE_DEFAULTS_FILE, TECH_STACK_FILE, } from "../../utils/constants.js";
import { errorFactories, requireProjectRoot, runCommand } from "../../utils/errors.js";
import { enforceFliskVersionGate } from "../../utils/flisk-version-gate.js";
import { runJsonCommand } from "../../utils/json-command.js";
import { findProjectRoot } from "../../utils/paths.js";
import { regeneratePlan } from "./plan.js";
/**
 * The `flisk config regenerate` action: a `--json` envelope, a grouped diff on `--dry-run`,
 * or a rewrite of the master files.
 */
export async function regenerateAction(options) {
    if (options.json) {
        await runJsonCommand("REGENERATE_FAILED", "flisk config regenerate", async () => {
            const projectRoot = findProjectRoot();
            if (!projectRoot)
                throw errorFactories.notInProject();
            enforceFliskVersionGate(projectRoot, {
                ignoreVersion: options.ignoreVersion,
                json: options.json,
            });
            const changes = regeneratePlan(projectRoot);
            if (!options.dryRun) {
                await generateMasterConfigs(projectRoot, { discardHandEdits: true, quiet: true });
            }
            return {
                data: {
                    dryRun: Boolean(options.dryRun),
                    hasChanges: changes.some((change) => change.status !== "unchanged"),
                    changes,
                    // Written by `flisk up`, not by regenerate: listed so a caller does not take "regenerated" for "up to date".
                    staleServiceOutputs: staleServiceOutputs(projectRoot),
                },
            };
        });
        return;
    }
    await runCommand(async () => {
        const projectRoot = requireProjectRoot();
        enforceFliskVersionGate(projectRoot, {
            ignoreVersion: options.ignoreVersion,
            json: options.json,
        });
        // The plan is the comparison report, so it supplies its own printer rather than the standard pair.
        if (handleDryRun(options, "", "", () => {
            console.log(chalk.blue("🔍 Dry run - comparing current files with new configuration...\n"));
            const projectConfig = readProjectConfig(projectRoot);
            const engine = new TemplateEngine();
            const newFiles = engine.generateAll(projectConfig, { projectRoot });
            const outputDir = join(projectRoot, ".flisk", ".flisk-out");
            const filesToCheck = MASTER_CONFIG_FILES;
            const fileGroups = [
                {
                    title: "📋 Core orchestration",
                    files: [TECH_STACK_FILE, RESOURCE_DEFAULTS_FILE],
                    description: "Tilt tech stack and resource defaults; drives all service generation",
                },
                {
                    title: "📦 Project spec",
                    files: ["spec.master"],
                    description: "Compiled project specification; used by Tilt for service discovery",
                },
            ];
            let hasChanges = false;
            for (const group of fileGroups) {
                let groupHasChanges = false;
                const groupChanges = [];
                for (const filename of group.files) {
                    if (!filesToCheck.includes(filename))
                        continue;
                    if (!isMasterConfigFileName(filename))
                        continue;
                    const newContent = newFiles[filename];
                    const filePath = join(outputDir, filename);
                    if (!existsSync(filePath)) {
                        groupHasChanges = true;
                        groupChanges.push({ filename, isNew: true, lineDiff: 0, diffLines: [] });
                        continue;
                    }
                    const currentContent = readFileSync(filePath, "utf-8");
                    if (currentContent !== newContent) {
                        groupHasChanges = true;
                        const currentLines = currentContent.split("\n").length;
                        const newLines = newContent.split("\n").length;
                        const lineDiff = newLines - currentLines;
                        const currentLinesArr = currentContent.split("\n");
                        const newLinesArr = newContent.split("\n");
                        let firstDiffLine = -1;
                        for (let i = 0; i < Math.max(currentLinesArr.length, newLinesArr.length); i++) {
                            if (currentLinesArr[i] !== newLinesArr[i]) {
                                firstDiffLine = i;
                                break;
                            }
                        }
                        const diffLines = [];
                        if (firstDiffLine >= 0) {
                            const contextStart = Math.max(0, firstDiffLine - 1);
                            const contextEnd = Math.min(currentLinesArr.length, firstDiffLine + 2);
                            for (let i = contextStart; i < contextEnd; i++) {
                                const line = currentLinesArr[i];
                                const newLine = newLinesArr[i];
                                if (line !== newLine) {
                                    if (line !== undefined) {
                                        diffLines.push(chalk.red(`     - ${line.substring(0, 60)}${line.length > 60 ? "..." : ""}`));
                                    }
                                    if (newLine !== undefined) {
                                        diffLines.push(chalk.green(`     + ${newLine.substring(0, 60)}${newLine.length > 60 ? "..." : ""}`));
                                    }
                                }
                                else if (line !== undefined) {
                                    diffLines.push(chalk.gray(`       ${line.substring(0, 60)}${line.length > 60 ? "..." : ""}`));
                                }
                            }
                        }
                        groupChanges.push({ filename, isNew: false, lineDiff, diffLines });
                    }
                }
                if (groupHasChanges) {
                    console.log(chalk.blue(`\n${group.title}`));
                    console.log(chalk.gray(`   ${group.description}\n`));
                    for (const change of groupChanges) {
                        if (change.isNew) {
                            console.log(chalk.yellow(`  📁 ${change.filename}`));
                            console.log(chalk.gray("     Status: NEW (file does not exist)\n"));
                        }
                        else {
                            console.log(chalk.yellow(`  📝 ${change.filename}`));
                            console.log(chalk.gray("     Status: MODIFIED"));
                            if (change.lineDiff > 0) {
                                console.log(chalk.gray(`     Lines: +${change.lineDiff}`));
                            }
                            else if (change.lineDiff < 0) {
                                console.log(chalk.gray(`     Lines: ${change.lineDiff}`));
                            }
                            else {
                                console.log(chalk.gray("     Lines: content changed"));
                            }
                            for (const diffLine of change.diffLines) {
                                console.log(diffLine);
                            }
                            console.log("");
                        }
                    }
                    hasChanges = true;
                }
                else {
                    console.log(chalk.green(`\n✅ ${group.title} — all up to date`));
                    console.log(chalk.gray(`   ${group.description}\n`));
                }
            }
            if (hasChanges) {
                console.log(chalk.blue("💡 Run without --dry-run to apply these changes.\n"));
            }
            else {
                console.log(chalk.green("✅ All files are already up to date!\n"));
            }
        })) {
            return;
        }
        console.log(chalk.blue("📋 Regenerating master configuration files...\n"));
        await generateMasterConfigs(projectRoot, { discardHandEdits: true });
        console.log(chalk.green("\n✅ Configuration regenerated!"));
        console.log(chalk.gray("   If a stack is already running, restart it (`flisk down && flisk up`) so Tilt applies changes to enabled resources."));
        const stale = staleServiceOutputs(projectRoot);
        if (stale.length > 0) {
            console.log(chalk.yellow(`\n⚠️  ${stale.length} service${stale.length === 1 ? "" : "s"} still ${stale.length === 1 ? "has" : "have"} generated files (compose, Dockerfile) written from an older service.json:`));
            for (const file of stale)
                console.log(chalk.gray(`   ${file}`));
            console.log(chalk.gray("   `flisk config regenerate` rewrites the master files only; `flisk up` writes these, and `flisk config verify` reports them until then."));
        }
    });
}
