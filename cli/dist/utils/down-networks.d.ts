type CommandRunner = (command: string, args: string[]) => string;
/** The engine prefixes networks with the project name, hyphens turned into underscores. */
export declare function projectNetworkNames(projectName: string): string[];
/**
 * Prefixes of Flisk projects among `networkNames`, from the networks the engine creates. Generic suffixes such as
 * `backend` also occur in non-Flisk compose projects, so a prefix counts only if it has a Traefik network, which
 * only Flisk creates.
 */
export declare function fliskNetworkPrefixes(networkNames: string[]): Set<string>;
/** The Flisk project prefix a network belongs to (`umami` for `umami_backend`), or null. */
export declare function fliskNetworkOwner(name: string, prefixes: Set<string>): string | null;
export interface PruneNetworksResult {
    removed: string[];
    /** Networks that exist but Docker refused to remove, usually because a container is still attached. */
    kept: {
        name: string;
        reason: string;
    }[];
}
export declare function parseNetworkNames(output: string): string[];
/** The names from `docker network ls`, for callers that already listed networks before pruning (#4173). */
export declare function listProjectNetworks(commandRunner?: CommandRunner): string[];
/**
 * Remove this project's own networks. Only the exact names the engine creates are touched, and `docker network rm`
 * itself refuses a network that still has containers attached, so another project's networks and in-use networks
 * are never removed. `existingNetworks` reuses a list read earlier on the idle path, avoiding a second network ls.
 */
export declare function pruneProjectNetworks(projectName: string, commandRunner?: CommandRunner, existingNetworks?: readonly string[]): PruneNetworksResult;
export interface PruneNetworksPlan {
    /** Networks `--prune-networks` would remove: they exist and no container outside the stopped stacks is attached. */
    remove: string[];
    /** Networks it would leave in place, with the reason (another container is attached, or Docker could not list them). */
    keep: {
        name: string;
        reason: string;
    }[];
}
/**
 * What {@link pruneProjectNetworks} would do, without removing anything: the same exact project network names, each
 * checked with `docker ps --filter network=<name>` for running attached containers (the reason `docker network rm`
 * refuses one). `down` stops before it prunes, so containers of the compose projects in `stoppedByDown` (this project's
 * stacks, from {@link projectComposeProjects}) do not count: they will be gone by the time the network is removed.
 */
export declare function planProjectNetworkPrune(projectName: string, commandRunner?: CommandRunner, stoppedByDown?: readonly string[]): PruneNetworksPlan;
export {};
