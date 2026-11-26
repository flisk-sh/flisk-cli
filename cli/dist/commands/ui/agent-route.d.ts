import type { DiscoveredResource } from "../../types/index.js";
/**
 * The address the agent panel reads the selected agent through: its ingress route, or localhost at its own port when every
 * service runs as a local process. Null when the selection is not an agent or it has no address.
 */
export declare function agentRouteOf(services: readonly DiscoveredResource[], selectedService: string | null | undefined, ingressPort: number | undefined): {
    name: string;
    url: string;
} | null;
