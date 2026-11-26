import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/** The non-loopback host address (`0.0.0.0:80/tcp`) a running container publishes this host port on, or null. */
export declare function liveNetworkAddress(dockerPs: string, hostPort: number, containerPort: number, protocol: string): string | null;
/**
 * An `extraPorts` entry with `"bind": "0.0.0.0"` (#2935), or a `publish` that resolves to one (a bare port, 0.0.0.0 or any
 * non-loopback address), is reachable from every device on the network, unlike everything else Flisk publishes. Say so in
 * `flisk doctor`, as a warning, so it stays a visible choice. A `publish` variable is read from the shell and the project `.env`
 * the way Compose reads it; a value that is not a port or address:port is named, because Compose would refuse it.
 */
export declare function checkNetworkPorts(projectRoot?: string, resources?: DiscoveredResource[], dockerPorts?: () => string): CheckResult;
/** A port outside 1-65535 can never be bound, and `flisk up` would otherwise find out only when Docker fails. */
export declare function checkServicePorts(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
/**
 * A resource's own Dockerfile can drift from its service.json after a re-registration (#3738) or a hand edit:
 * `ENV PORT`, `EXPOSE` and the healthcheck keep the old number while `port` moves on. `flisk up` then publishes the
 * new port to a container that still listens on the old one, and only the healthcheck reveals the mismatch. Local
 * process resources have no Dockerfile, so they are skipped.
 */
export declare function checkDockerfilePorts(projectRoot?: string, resources?: DiscoveredResource[]): CheckResult;
