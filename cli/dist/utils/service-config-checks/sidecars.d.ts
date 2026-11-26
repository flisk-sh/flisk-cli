import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * A `sidecarOf` (#2908) becomes `network_mode: "service:<host>"` in the stack's Compose file, so the host must be a resource in
 * the same stack. Otherwise Compose stops with "service ... depends on undefined service", after `flisk up` has said yes.
 */
export declare function checkSidecars(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
