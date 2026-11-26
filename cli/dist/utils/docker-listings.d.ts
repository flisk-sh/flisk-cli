/** The widest formats: everything the purge and the stale-project label scan need, in four calls. */
export declare const CONTAINER_LIST_ARGS: readonly string[];
export declare const VOLUME_LIST_ARGS: readonly string[];
export declare const NETWORK_LIST_ARGS: readonly string[];
export declare const IMAGE_LIST_ARGS: readonly string[];
/** Raw stdout of the four Docker listings, shared by the purge and stale-project scans. */
export interface DockerListings {
    containers: string;
    volumes: string;
    networks: string;
    images: string;
    /** True when any listing command failed, so an empty listing may mean "could not look", not "nothing there". */
    failed?: boolean;
}
export type DockerListingRun = (args: string[]) => string | Promise<string>;
/** Reads the four independent listings together. A failed listing is treated as an empty one and sets `failed`. */
export declare function readDockerListings(run?: DockerListingRun): Promise<DockerListings>;
export declare function listingLines(output: string): string[];
export interface ContainerRow {
    id: string;
    names: string;
    size: string;
    composeProject: string;
    composeDir: string;
    fliskProject: string;
    fliskDir: string;
}
/** Parses the wide listing and the older two-column form used by `flisk down --purge`. */
export declare function parseContainerRows(output: string): ContainerRow[];
export interface VolumeRow {
    name: string;
    composeProject: string;
    composeDir: string;
    fliskProject: string;
    fliskDir: string;
    /** The `sh.flisk.native-root` label Flisk puts on a volume it creates. */
    nativeRoot: string;
}
/**
 * Parses the wide listing (name, Compose project, Compose dir, Flisk project, Flisk dir, native root) and the short
 * form used by `flisk down --purge` (name, Compose project, native root).
 */
export declare function parseVolumeRows(output: string): VolumeRow[];
export interface NetworkRow {
    name: string;
    composeProject: string;
    composeDir: string;
    fliskProject: string;
    fliskDir: string;
}
/** Parses the wide listing and the older name-only form used by `flisk down --purge`. */
export declare function parseNetworkRows(output: string): NetworkRow[];
export declare function parseImageRefs(output: string): string[];
