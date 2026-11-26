import type { CheckResult, DiscoveredResource } from "../../../types/index.js";
/**
 * Two resources with one appName share a Compose service name and Traefik router and service names
 * (all built from the name, none from the directory), so one of them is lost or misrouted.
 */
export declare function checkDuplicateResourceNames(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
/**
 * Two routed resources on one `port`. This is a warning, not a failure: the engine publishes no service
 * port on the host and gives each resource its own container, which Traefik reaches as <container>:<port>,
 * so two containers can listen on 4000 at once. The pair still confuses the checks and URLs that identify
 * a backend by its port, and usually means a copied service.json.
 */
export declare function checkDuplicateResourcePorts(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
