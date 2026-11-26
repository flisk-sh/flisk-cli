import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/** A dependsOn that is not a list of service names cannot be followed, so say so instead of failing later. */
export declare function checkDependsOnShape(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
/** Services that wait on each other can never both start. A dependsOn name that is not a service is left to the unknown-name check. */
export declare function checkCircularDependencies(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
