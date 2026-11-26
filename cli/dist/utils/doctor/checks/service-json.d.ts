import type { CheckResult } from "../../../types/index.js";
/**
 * A service.json that does not parse, or that misses the required fields, is skipped by discovery:
 * its service vanishes from every other check and only a stderr warning says why. Doctor is where
 * the project asks "is everything OK?", so the skipped files are a failing check here (#5143).
 */
export declare function checkValidServiceJsonFiles(projectRoot?: string): CheckResult;
