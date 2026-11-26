import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * Everything `flisk config verify` reports about one service.json's own fields (Docker-safe names, field types, line breaks,
 * route paths), applied before `flisk up` starts anything. Without it a bad value passed `flisk up` and stopped inside Tilt
 * ("repository name must be lowercase", "string has no .get field or method"). A missing schemaVersion or required field is
 * left out: old projects keep working without them, and `flisk config migrate` adds the version.
 */
export declare function checkServiceFields(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
