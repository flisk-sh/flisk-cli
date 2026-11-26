import { isPlainObject } from "./is-plain-object.js";
import { isNativeContainerService } from "./native-container.js";
/**
 * The minimal service contract (openspec/changes/make-flisk-unopinionated, #2227): a service.json that declares a top-level
 * `command` runs as a local process started by `flisk up`, with no image, no Dockerfile and no generated files.
 *
 * ```json
 * { "appName": "api", "appType": "backend", "command": "node server.js", "port": 4000, "env": { "GREETING": "hi" }, "dependsOn": [] }
 * ```
 *
 * `dev.command` is a different field: it is the dev command inside a generated container (see the Python example) and does not
 * make a service native.
 */
/** Container runtime sources. A service has exactly one runtime source, so `command` excludes both. */
const CONTAINER_SOURCE_FIELDS = ["image", "dockerfile"];
/** True when the manifest declares a non-empty top-level `command`. */
export function declaresCommand(manifest) {
    return typeof manifest?.command === "string" && manifest.command.trim() !== "";
}
/**
 * True when the service declares its own Dockerfile, at the top level or in the
 * `build.dockerfile` spelling. That file owns the image build, so Flisk's
 * generated build steps (and the files they copy, like a frontend's `public/`)
 * do not apply.
 */
export function declaresOwnDockerfile(config) {
    if (!config || typeof config !== "object")
        return false;
    const record = config;
    if (typeof record.dockerfile === "string" && record.dockerfile.trim() !== "")
        return true;
    const build = record.build;
    if (!build || typeof build !== "object")
        return false;
    const dockerfile = build.dockerfile;
    return typeof dockerfile === "string" && dockerfile.trim() !== "";
}
/** True for a service that runs as a local process (its service.json declares `command`). */
export function isNativeService(resource) {
    return declaresCommand(resource.config);
}
/**
 * The field a service's non-secret config is read from: `params`, or the deprecated `envVars` when `params` is
 * absent. The generated container env file reads it the same way
 * (runtime/engine/topologies/tilt/resources/orchestrator/generators/env.star).
 */
export function paramsFieldOf(manifest) {
    return manifest !== undefined && "params" in manifest ? "params" : "envVars";
}
/**
 * The non-secret config `params` (or `envVars`) declares for a service's environment, as literal strings: no
 * `${VAR}` expansion, which stays `env`'s contract. A malformed block reads as none and is reported by
 * validateNativeServiceFields for a `command` service, by fieldTypeErrors otherwise.
 */
export function paramsOf(manifest) {
    const value = manifest?.[paramsFieldOf(manifest)];
    if (!isPlainObject(value))
        return {};
    const params = {};
    for (const [key, entry] of Object.entries(value))
        params[key] = String(entry);
    return params;
}
/**
 * Errors in the native part of one service.json: a second runtime source next to `command`, a `command` that is not a string,
 * and an `env` that is not a map of strings. Each error names the service, so a project with many files says which one is wrong.
 * A manifest without `command` returns no errors: the container contract is validated elsewhere and is unchanged.
 */
export function validateNativeServiceFields(manifest) {
    const name = serviceLabel(manifest);
    const errors = [];
    if ("command" in manifest && !declaresCommand(manifest)) {
        errors.push(`service ${name}: command must be a non-empty string`);
    }
    if (!declaresCommand(manifest))
        return errors;
    const conflicting = CONTAINER_SOURCE_FIELDS.filter((field) => manifest[field] !== undefined && manifest[field] !== "");
    if (conflicting.length > 0) {
        errors.push(`service ${name}: declares both command and ${conflicting.join(" and ")}; a service has exactly one runtime source (remove ${conflicting.length === 1 ? "it" : "them"} to run the command locally, or remove command to run in Docker)`);
    }
    // `params` (or `envVars` when `params` is absent) is read into the process environment like `env`, so it
    // follows the same shape. When `params` is present `envVars` is never read, so it is not checked either.
    for (const field of ["env", paramsFieldOf(manifest)]) {
        errors.push(...envMapErrors(manifest, field, name));
    }
    return errors;
}
/**
 * `env`, `params` and `envVars` each map environment variable names to string values. Returns the errors for one
 * of those fields of a `command` service's manifest; an absent field is fine.
 */
function envMapErrors(manifest, field, name) {
    const value = manifest[field];
    if (value === undefined)
        return [];
    if (!isPlainObject(value)) {
        return [`service ${name}: ${field} must be an object of string values`];
    }
    const badKeys = Object.entries(value)
        .filter(([key, entry]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof entry !== "string")
        .map(([key]) => key);
    if (badKeys.length === 0)
        return [];
    return [
        `service ${name}: ${field} ${badKeys.join(", ")}: names must be letters, digits or _ (not starting with a digit) and values must be strings`,
    ];
}
/** How an error names a service: its quoted appName, or "(unnamed)". */
export function serviceLabel(manifest) {
    const name = manifest.appName;
    return typeof name === "string" && name ? `"${name}"` : "(unnamed)";
}
/**
 * How `flisk up` runs a selection: natively when every selected service declares `command`, or declares `command` or a
 * ready-made `image` with at least one `command` (a mixed run: the images start with `docker run` next to the local processes),
 * and in containers (Docker + Tilt) when none declares `command`. Any other mix (a service built from a Dockerfile next to a
 * local process), or a container selection in a project that also holds native services (Tilt discovers every service.json,
 * not just the selected ones), cannot run: `mixed` lists the native services in the way.
 */
export function resolveRuntimeMode(selected, all = selected) {
    const native = all.filter(isNativeService).map((resource) => resource.name);
    if (selected.some(isNativeService) &&
        selected.every((resource) => isNativeService(resource) || isNativeContainerService(resource))) {
        return { mode: "native", mixed: [] };
    }
    return { mode: "container", mixed: native };
}
/** The refusal for a selection that mixes native and container services. `typoNotes` names near-miss
 * service.json keys of the services in the error, so a `comand` reads as the cause, not the Dockerfile mix. */
export function formatMixedRuntimeRefusal(nativeNames, containerNames, typoNotes = []) {
    return [
        `This run mixes services that run as local processes (${nativeNames.join(", ")}) with services that run in Docker (${containerNames.join(", ")}).`,
        "A local-process run can start containers only from a ready-made `image` (a database, a cache); a service built from a Dockerfile cannot join it.",
        "Give the Docker services an `image` instead of a Dockerfile, give every service a `command`, or remove `command` from the local services to run everything in Docker.",
        ...typoNotes,
    ].join("\n");
}
/**
 * The refusal for a selection of ready-made images alone in a project with local-process services. The run is not mixed:
 * it contains no local process, and an image starts only next to one (a container run would make Tilt discover the
 * project's `command` services). `nativeNames` names one local service the suggestion can offer to start with the images.
 */
export function formatImageOnlyRuntimeRefusal(imageNames, nativeNames) {
    const quoted = imageNames.map((name) => `"${name}"`).join(", ");
    const lines = [
        `${quoted} ${imageNames.length === 1 ? "is a ready-made image" : "are ready-made images"}, and images start only next to a local process in the same run.`,
    ];
    const firstNative = nativeNames[0];
    if (firstNative === undefined) {
        lines.push("Start the selection together with a service that declares a `command`.");
    }
    else {
        lines.push(`Add a local service: flisk up --only ${[...imageNames, firstNative].join(" ")}`);
    }
    return lines.join("\n");
}
/**
 * True when `flisk up` runs a project as local processes, so Compose, Tilt and the gateway are not used: every service declares
 * `command`, or some do and the rest are ready-made `image` containers (a mixed run, which still needs Docker for those). An
 * empty project is not native.
 */
export function isNativeProject(resources) {
    return (resources.some(isNativeService) &&
        resources.every((resource) => isNativeService(resource) || isNativeContainerService(resource)));
}
/** The program a shell command runs first (`node` for `PORT=1 node server.js`), or null when it cannot be told. */
export function commandProgram(command) {
    const words = command.trim().split(/\s+/);
    for (const word of words) {
        // Leading VAR=value assignments set the environment of the program, they are not the program.
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
            continue;
        if (word === "exec" || word === "env")
            continue;
        return /^[A-Za-z0-9_./@+-]+$/.test(word) ? word : null;
    }
    return null;
}
