import { isNativeProject } from "../../utils/native-service.js";
import { buildServicePorts } from "../../utils/status-ports.js";
/**
 * The address the agent panel reads the selected agent through: its ingress route, or localhost at its own port when every
 * service runs as a local process. Null when the selection is not an agent or it has no address.
 */
export function agentRouteOf(services, selectedService, ingressPort) {
    const resource = services.find((s) => s.name === selectedService);
    if (!resource || (resource.config?.appType ?? resource.type) !== "agent")
        return null;
    const native = isNativeProject(services);
    const ports = buildServicePorts(resource, ingressPort, { native });
    const url = native ? ports.directUrl : ports.url;
    return url ? { name: resource.name, url } : null;
}
