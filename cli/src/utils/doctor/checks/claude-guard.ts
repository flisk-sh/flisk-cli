// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { CheckResult } from "../../../types/index.js";
import { claudeGuardHookIsOrphaned, GENERATED_GUARD_HOOK } from "../../agent-skills.js";
import { findProjectRoot } from "../../paths.js";

/**
 * The guard script and the settings entry that runs it are one feature (#5425). An orphan script looks like
 * protection to the agent opening the project, but nothing calls it, so `flisk doctor` must say so.
 */
export function checkClaudeGeneratedGuardHook(
  projectRoot = findProjectRoot() ?? process.cwd(),
): CheckResult {
  const name = "Claude generated-file guard";
  if (!claudeGuardHookIsOrphaned(projectRoot)) {
    return {
      name,
      didPass: true,
      message: "No orphaned generated-file guard hook",
    };
  }
  return {
    name,
    didPass: true,
    isWarning: true,
    message: `${GENERATED_GUARD_HOOK} exists, but .claude/settings.json does not run it; edits to generated files are not blocked`,
    fix: "Add the hooks.PreToolUse entry from `flisk project` to .claude/settings.json, or delete the orphan hook script",
  };
}
