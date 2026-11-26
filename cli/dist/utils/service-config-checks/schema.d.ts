import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * A service.json with no schemaVersion is how every project began, so this is a warning: it keeps working, and only
 * `flisk config migrate` writes the field. A version this flisk does not know is reported the same way, with a different fix.
 */
export declare function checkSchemaVersions(projectRoot?: string, strict?: boolean, resources?: DiscoveredResource[]): CheckResult;
/** Prints the schemaVersion warning once. It never stops anything: the project keeps working as it is. */
export declare function warnSchemaVersions(projectRoot: string, resources?: DiscoveredResource[]): void;
