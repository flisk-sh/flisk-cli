import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/** Major version of a postgres or pgvector image reference (`postgres:18-alpine`, `pgvector/pgvector:pg18`), or null when it is neither or has no numeric tag. */
export function postgresImageMajor(image) {
    if (typeof image !== "string")
        return null;
    const withoutDigest = image.split("@")[0] ?? "";
    const lastSlash = withoutDigest.lastIndexOf("/");
    const colon = withoutDigest.indexOf(":", lastSlash + 1);
    if (colon === -1)
        return null;
    const repository = withoutDigest.slice(0, colon).replace(/^(?:docker\.io\/)?(?:library\/)?/, "");
    if (repository !== "postgres" && repository !== "pgvector/pgvector")
        return null;
    const match = /^(?:pg)?(\d+)/.exec(withoutDigest.slice(colon + 1));
    return match ? Number(match[1]) : null;
}
/**
 * Postgres 18 images keep the cluster below /var/lib/postgresql, and refuse to start when a volume is mounted at the
 * pre-18 /var/lib/postgresql/data. In a mixed run `flisk up` then restarts the container in a loop (#3139).
 */
export function postgresVolumeWarnings(projectRoot, resources) {
    return resources.flatMap((resource) => {
        const major = postgresImageMajor(resource.config?.image);
        if (major === null || major < 18)
            return [];
        const volumes = resource.config?.volumes;
        if (!Array.isArray(volumes))
            return [];
        return volumes.flatMap((volume, index) => {
            const target = volume?.target;
            if (typeof target !== "string")
                return [];
            let normalized = target;
            while (normalized.endsWith("/"))
                normalized = normalized.slice(0, -1);
            if (normalized !== "/var/lib/postgresql/data") {
                return [];
            }
            return [
                `${filePath(projectRoot, resource)} volumes[${index}].target ${target}: Postgres ${major} refuses to start with its data volume here. Mount /var/lib/postgresql instead`,
            ];
        });
    });
}
/** A warning, never an error: the project is valid, the container just will not start. */
export function checkPostgresVolumes(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot), strict = false) {
    const problems = postgresVolumeWarnings(projectRoot, resources);
    if (problems.length === 0) {
        return {
            name: "Postgres volume",
            didPass: true,
            message: "No Postgres 18+ image mounts its volume at /var/lib/postgresql/data",
        };
    }
    return {
        name: "Postgres volume",
        didPass: false,
        isWarning: !strict,
        message: `${formatCount(problems.length, "Postgres 18+ volume")} at the pre-18 path:\n    ${problems.join("\n    ")}`,
        fix: 'Set the volume "target" to /var/lib/postgresql (Postgres 18+ images store data in a versioned directory below it)',
    };
}
