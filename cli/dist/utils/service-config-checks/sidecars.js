import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/**
 * A `sidecarOf` (#2908) becomes `network_mode: "service:<host>"` in the stack's Compose file, so the host must be a resource in
 * the same stack. Otherwise Compose stops with "service ... depends on undefined service", after `flisk up` has said yes.
 */
export function checkSidecars(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const stackOf = new Map(resources.map((resource) => [resource.name, resource.config?.stack]));
    const problems = resources.flatMap((resource) => {
        const host = resource.config?.sidecarOf;
        if (typeof host !== "string" || host === "")
            return [];
        const at = `${filePath(projectRoot, resource)} sidecarOf "${host}"`;
        if (!stackOf.has(host))
            return [`${at}: no resource has that name`];
        if (stackOf.get(host) !== resource.config?.stack) {
            return [
                `${at}: is in stack "${String(stackOf.get(host))}", not "${String(resource.config?.stack)}"`,
            ];
        }
        return [];
    });
    if (problems.length === 0) {
        return {
            name: "Sidecars",
            didPass: true,
            message: "Every sidecarOf names a resource in its stack",
        };
    }
    return {
        name: "Sidecars",
        didPass: false,
        message: `${formatCount(problems.length, "invalid sidecarOf", "invalid sidecarOf")}:\n    ${problems.join("\n    ")}`,
        fix: 'Set "sidecarOf" to the appName of a resource in the same stack',
    };
}
