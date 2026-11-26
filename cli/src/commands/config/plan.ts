// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readProjectConfig, TemplateEngine } from "../../generator/template-engine.js";
import { MASTER_CONFIG_FILES } from "../../utils/constants.js";

/** How one master file changes on `flisk config regenerate`. `lineDiff` is new minus current lines (0 for a new file). */
export interface RegenerateChange {
  file: (typeof MASTER_CONFIG_FILES)[number];
  status: "new" | "modified" | "unchanged";
  lineDiff: number;
}

/** The change `flisk config regenerate` makes to each master file, from the same generator its dry run compares with. */
export function regeneratePlan(projectRoot: string): RegenerateChange[] {
  const newFiles = new TemplateEngine().generateAll(readProjectConfig(projectRoot), {
    projectRoot,
  });
  const outputDir = join(projectRoot, ".flisk", ".flisk-out");
  return MASTER_CONFIG_FILES.map((file): RegenerateChange => {
    const filePath = join(outputDir, file);
    if (!existsSync(filePath)) return { file, status: "new", lineDiff: 0 };
    const current = readFileSync(filePath, "utf-8");
    const next = newFiles[file];
    if (current === next) return { file, status: "unchanged", lineDiff: 0 };
    return {
      file,
      status: "modified",
      lineDiff: next.split("\n").length - current.split("\n").length,
    };
  });
}
