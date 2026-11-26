// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateMasterConfigs } from "../../generator/template-engine.js";
import type { DiscoveredResource } from "../../types/index.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import { FliskError } from "../../utils/errors.js";
import { writeJsonFile } from "../../utils/file-helpers.js";
import { showDetail, showSuccess } from "../../utils/formatting.js";

export type StackResourceConfig = {
  [key: string]: unknown;
  appName?: string;
  stack?: string;
};

export function parseStackResourceConfig(content: string, configPath: string): StackResourceConfig {
  try {
    return JSON.parse(content) as StackResourceConfig;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FliskError(`Could not parse service.json at ${configPath}: ${reason}`, [
      "Fix the JSON syntax in that file",
      "Check every service.json with: flisk config verify",
    ]);
  }
}

/** What the write-back changed: the manifests it reports, and every path that holds new content. */
export interface StackAssignment {
  assigned: { name: string; configPath: string }[];
  changedPaths: Set<string>;
}

/**
 * Write the stack field onto each selected service.json, relocating the folder
 * when a planned move takes `services/<stack>/<name>` to a different stack's
 * folder, then regenerate the stack wiring when anything relocated.
 */
export async function writeStackAssignments(args: {
  /** Canonical service.json paths to update, in request order. */
  selectedPaths: string[];
  /** Old service.json path -> new service.json path for resources that relocate folders. */
  relocations: Map<string, string>;
  /** The discovered resources, for display names and previous stacks. */
  resources: DiscoveredResource[];
  projectRoot: string;
  /** The stack to store, or null under --remove (the field is deleted instead). */
  targetStack: string | null;
  remove?: boolean;
  /** Runs after a relocation; defaults to the generated-config regeneration the command needs. */
  regenerate?: (projectRoot: string) => Promise<unknown>;
}): Promise<StackAssignment> {
  const regenerate =
    args.regenerate ?? ((root: string) => generateMasterConfigs(root, { quiet: true }));

  // Clear cache since we're about to modify resources
  clearDiscoveryCache();

  const nameByConfigPath = new Map(
    args.resources.map((resource) => [resource.configPath, resource.name] as const),
  );
  const previousStackByConfigPath = new Map(
    args.resources.map((resource) => [resource.configPath, resource.stack] as const),
  );
  const assigned: { name: string; configPath: string }[] = [];
  const changedPaths = new Set<string>();
  for (const configPath of args.selectedPaths) {
    const content = readFileSync(configPath, "utf-8");
    const config = parseStackResourceConfig(content, configPath);
    if (args.remove) delete config.stack;
    else config.stack = args.targetStack ?? undefined;

    const name = nameByConfigPath.get(configPath) ?? config.appName ?? configPath;
    let finalPath = configPath;
    const movedTo = args.relocations.get(configPath);
    if (movedTo) {
      mkdirSync(dirname(dirname(movedTo)), { recursive: true });
      writeJsonFile(configPath, config);
      try {
        renameSync(dirname(configPath), dirname(movedTo));
      } catch (error) {
        // The manifest already names the new stack, and the retry guard above
        // skips relocation once it does — so a failed rename would leave the
        // resource stranded in the old folder with no way to finish the move.
        // Put the old content back before rethrowing.
        writeFileSync(configPath, content);
        throw error;
      }
      finalPath = movedTo;
      showDetail(
        `moved ${name}: ${previousStackByConfigPath.get(configPath)} -> ${args.targetStack}`,
      );
    } else {
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
