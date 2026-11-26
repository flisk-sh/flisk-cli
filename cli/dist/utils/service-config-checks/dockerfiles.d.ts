import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * A custom `dockerfile` (relative to the service, or to its `buildContext`) that does not exist stops the Tiltfile with
 * "CUSTOM DOCKERFILE NOT FOUND" (discovery/manifest/loading.star), after `flisk up` has said yes.
 */
export declare function checkCustomDockerfiles(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
