import type { PortOwnerDetails } from "../types/index.js";
export type { PortOwnerDetails };
export type CommandRunner = (command: string, args: string[]) => string;
export type DockerRunner = (args: string[]) => string;
export interface PortOwnerOptions {
    platform?: NodeJS.Platform;
    processRunner?: CommandRunner;
    dockerRunner?: DockerRunner;
    env?: NodeJS.ProcessEnv;
}
/**
 * Return the relevant Flisk configuration setting for a given port, or undefined if no known setting controls it.
 */
export declare function getPortSetting(port: number, env?: NodeJS.ProcessEnv): string | undefined;
/**
 * True when one `docker ps` port mapping publishes `port` on the host. Handles
 * `[ip:]hostPort->container`, IPv6 binds, and same-number ranges such as
 * `0.0.0.0:8080-8082->8080-8082/tcp`.
 */
export declare function mappingPublishesHostPort(mapping: string, port: number): boolean;
export interface DockerPublishedPort {
    container: string;
    image?: string;
}
/** Host port numbers one `docker ps` port mapping publishes (`[ip:]port->port` or a same-number range). */
export declare function publishedHostPorts(mapping: string): number[];
/**
 * Every host port a running container publishes, from the output of
 * `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'`, mapped to the container that publishes it.
 * The planner and the doctor checks read this same map so a port a container already holds can never
 * be reported free by one and busy by the other (#4216).
 */
export declare function dockerPublishedPorts(dockerPsOutput: string): Map<number, DockerPublishedPort>;
/**
 * Find whether a published Docker container owns the specified port.
 */
export declare function findDockerPortOwner(port: number, dockerRunner?: DockerRunner, env?: NodeJS.ProcessEnv): PortOwnerDetails | null;
/**
 * Find whether a local host process owns the specified port using lsof and ps.
 */
export declare function findProcessPortOwner(port: number, platform?: NodeJS.Platform, commandRunner?: CommandRunner, env?: NodeJS.ProcessEnv): PortOwnerDetails | null;
/**
 * Identify the process or container using a busy port.
 * Checks Docker published ports first, then falls back to host processes via lsof.
 */
export declare function findPortOwner(port: number, options?: PortOwnerOptions): PortOwnerDetails | null;
/**
 * Format human-readable diagnostics for a port conflict, matching Flisk doctor expectations.
 */
export declare function formatPortOwnerDiagnostic(port: number, owner: PortOwnerDetails | null, fallbackMessage?: string): {
    message: string;
    fix: string;
};
