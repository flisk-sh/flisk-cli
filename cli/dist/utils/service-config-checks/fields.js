import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { validateServiceManifest } from "../service-manifest.js";
import { discoverResourcesFromRoot } from "../services.js";
import { filePath } from "./shared.js";
/**
 * Everything `flisk config verify` reports about one service.json's own fields (Docker-safe names, field types, line breaks,
 * route paths), applied before `flisk up` starts anything. Without it a bad value passed `flisk up` and stopped inside Tilt
 * ("repository name must be lowercase", "string has no .get field or method"). A missing schemaVersion or required field is
 * left out: old projects keep working without them, and `flisk config migrate` adds the version.
 */
export function checkServiceFields(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const problems = resources.flatMap((resource) => validateServiceManifest({
        ...(resource.config ?? {}),
        // A service with no appName is named after its directory; that name has to be Docker-safe too. A wrong-typed one is reported.
        appName: resource.config && "appName" in resource.config ? resource.config.appName : resource.name,
    }, filePath(projectRoot, resource)).errors.filter((error) => !/required field is missing|\.schemaVersion:/.test(error)));
    if (problems.length === 0) {
        return { name: "Service fields", didPass: true, message: "Every service.json field is valid" };
    }
    return {
        name: "Service fields",
        didPass: false,
        message: `${formatCount(problems.length, "invalid field")}:\n    ${problems.join("\n    ")}`,
        fix: "Correct the field in service.json; the published schema (flisk.sh/schema.service.json) lists each field's type",
    };
}
