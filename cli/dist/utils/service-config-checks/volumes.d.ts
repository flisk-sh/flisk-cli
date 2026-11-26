import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * A bind mount in `volumes` (#1748) is relative to its service directory, and one that climbs out of the project would hand a
 * container files Flisk was never asked to share. The generator refuses it too, after `flisk up` has said yes.
 */
export declare function checkVolumes(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
