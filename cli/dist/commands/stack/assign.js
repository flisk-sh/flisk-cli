// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateMasterConfigs } from "../../generator/template-engine.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import { FliskError } from "../../utils/errors.js";
import { writeJsonFile } from "../../utils/file-helpers.js";
import { showDetail, showSuccess } from "../../utils/formatting.js";
export function parseStackResourceConfig(content, configPath) {
    try {
        return JSON.parse(content);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new FliskError(`Could not parse service.json at ${configPath}: ${reason}`, [
            "Fix the JSON syntax in that file",
            "Check every service.json with: flisk config verify",
        ]);
    }
}
/**
 * Write the stack field onto each selected service.json, relocating the folder
 * when a planned move takes `services/<stack>/<name>` to a different stack's
 * folder, then regenerate the stack wiring when anything relocated.
 */
export async function writeStackAssignments(args) {
    const regenerate = args.regenerate ?? ((root) => generateMasterConfigs(root, { quiet: true }));
    // Clear cache since we're about to modify resources
    clearDiscoveryCache();
    const nameByConfigPath = new Map(args.resources.map((resource) => [resource.configPath, resource.name]));
    const previousStackByConfigPath = new Map(args.resources.map((resource) => [resource.configPath, resource.stack]));
    const assigned = [];
    const changedPaths = new Set();
    for (const configPath of args.selectedPaths) {
        const content = readFileSync(configPath, "utf-8");
        const config = parseStackResourceConfig(content, configPath);
        if (args.remove)
            delete config.stack;
        else
            config.stack = args.targetStack ?? undefined;
        const name = nameByConfigPath.get(configPath) ?? config.appName ?? configPath;
        let finalPath = configPath;
        const movedTo = args.relocations.get(configPath);
        if (movedTo) {
            mkdirSync(dirname(dirname(movedTo)), { recursive: true });
            writeJsonFile(configPath, config);
            try {
                renameSync(dirname(configPath), dirname(movedTo));
            }
            catch (error) {
                // The manifest already names the new stack, and the retry guard above
                // skips relocation once it does — so a failed rename would leave the
                // resource stranded in the old folder with no way to finish the move.
                // Put the old content back before rethrowing.
                writeFileSync(configPath, content);
                throw error;
            }
            finalPath = movedTo;
            showDetail(`moved ${name}: ${previousStackByConfigPath.get(configPath)} -> ${args.targetStack}`);
        }
        else {
            writeJsonFile(configPath, config);
        }
        changedPaths.add(configPath);
        changedPaths.add(finalPath);
        assigned.push({ name, configPath: finalPath });
        showSuccess(`${config.appName || configPath}`);
    }
    if (args.relocations.size > 0) {
        // A move does not authorize discarding hand edits to the root .tiltignore;
        // that stays behind `flisk config regenerate` (`discardHandEdits`).
        await regenerate(args.projectRoot);
    }
    return { assigned, changedPaths };
}
