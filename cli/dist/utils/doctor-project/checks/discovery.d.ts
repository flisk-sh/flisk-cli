import type { CheckResult } from "../../../types/index.js";
/**
 * Tilt only builds resources under `discovery.paths`, but the CLI finds every service.json,
 * so a resource outside them is listed and given a URL by `flisk up` yet never started.
 */
export declare function checkResourceDiscovery(): CheckResult;
