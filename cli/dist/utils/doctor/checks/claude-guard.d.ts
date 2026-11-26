import type { CheckResult } from "../../../types/index.js";
/**
 * The guard script and the settings entry that runs it are one feature (#5425). An orphan script looks like
 * protection to the agent opening the project, but nothing calls it, so `flisk doctor` must say so.
 */
export declare function checkClaudeGeneratedGuardHook(projectRoot?: string): CheckResult;
