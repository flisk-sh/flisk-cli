import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/** Major version of a postgres or pgvector image reference (`postgres:18-alpine`, `pgvector/pgvector:pg18`), or null when it is neither or has no numeric tag. */
export declare function postgresImageMajor(image: unknown): number | null;
/**
 * Postgres 18 images keep the cluster below /var/lib/postgresql, and refuse to start when a volume is mounted at the
 * pre-18 /var/lib/postgresql/data. In a mixed run `flisk up` then restarts the container in a loop (#3139).
 */
export declare function postgresVolumeWarnings(projectRoot: string, resources: DiscoveredResource[]): string[];
/** A warning, never an error: the project is valid, the container just will not start. */
export declare function checkPostgresVolumes(projectRoot?: string, resources?: DiscoveredResource[], strict?: boolean): CheckResult;
