import type { CheckResult } from "../../../types/index.js";
/**
 * New resources are rejected by `validateResourceName`, but a project created before that check
 * can still have a folder named `logs`, `dist`, etc. Tilt silently ignores every file under such a
 * folder, so doctor names the affected resources (#5453).
 */
export declare function checkTiltIgnoredResourceNames(): CheckResult;
