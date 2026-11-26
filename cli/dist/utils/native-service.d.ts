import type { DiscoveredResource } from "../types/index.js";
/** What a project's selected services need from the machine to run. */
export type RuntimeMode = "native" | "container";
/** True when the manifest declares a non-empty top-level `command`. */
export declare function declaresCommand(manifest: Record<string, unknown> | undefined): boolean;
/**
 * True when the service declares its own Dockerfile, at the top level or in the
 * `build.dockerfile` spelling. That file owns the image build, so Flisk's
 * generated build steps (and the files they copy, like a frontend's `public/`)
 * do not apply.
 */
export declare function declaresOwnDockerfile(config: unknown): boolean;
/** True for a service that runs as a local process (its service.json declares `command`). */
export declare function isNativeService(resource: DiscoveredResource): boolean;
/**
 * The field a service's non-secret config is read from: `params`, or the deprecated `envVars` when `params` is
 * absent. The generated container env file reads it the same way
 * (runtime/engine/topologies/tilt/resources/orchestrator/generators/env.star).
 */
export declare function paramsFieldOf(manifest: Record<string, unknown> | undefined): "params" | "envVars";
/**
 * The non-secret config `params` (or `envVars`) declares for a service's environment, as literal strings: no
 * `${VAR}` expansion, which stays `env`'s contract. A malformed block reads as none and is reported by
 * validateNativeServiceFields for a `command` service, by fieldTypeErrors otherwise.
 */
export declare function paramsOf(manifest: Record<string, unknown> | undefined): Record<string, string>;
/**
 * Errors in the native part of one service.json: a second runtime source next to `command`, a `command` that is not a string,
 * and an `env` that is not a map of strings. Each error names the service, so a project with many files says which one is wrong.
 * A manifest without `command` returns no errors: the container contract is validated elsewhere and is unchanged.
 */
export declare function validateNativeServiceFields(manifest: Record<string, unknown>): string[];
/** How an error names a service: its quoted appName, or "(unnamed)". */
export declare function serviceLabel(manifest: Record<string, unknown>): string;
/**
 * How `flisk up` runs a selection: natively when every selected service declares `command`, or declares `command` or a
 * ready-made `image` with at least one `command` (a mixed run: the images start with `docker run` next to the local processes),
 * and in containers (Docker + Tilt) when none declares `command`. Any other mix (a service built from a Dockerfile next to a
 * local process), or a container selection in a project that also holds native services (Tilt discovers every service.json,
 * not just the selected ones), cannot run: `mixed` lists the native services in the way.
 */
export declare function resolveRuntimeMode(selected: DiscoveredResource[], all?: DiscoveredResource[]): {
    mode: RuntimeMode;
    mixed: string[];
};
/** The refusal for a selection that mixes native and container services. `typoNotes` names near-miss
 * service.json keys of the services in the error, so a `comand` reads as the cause, not the Dockerfile mix. */
export declare function formatMixedRuntimeRefusal(nativeNames: string[], containerNames: string[], typoNotes?: readonly string[]): string;
/**
 * The refusal for a selection of ready-made images alone in a project with local-process services. The run is not mixed:
 * it contains no local process, and an image starts only next to one (a container run would make Tilt discover the
 * project's `command` services). `nativeNames` names one local service the suggestion can offer to start with the images.
 */
export declare function formatImageOnlyRuntimeRefusal(imageNames: string[], nativeNames: string[]): string;
/**
 * True when `flisk up` runs a project as local processes, so Compose, Tilt and the gateway are not used: every service declares
 * `command`, or some do and the rest are ready-made `image` containers (a mixed run, which still needs Docker for those). An
 * empty project is not native.
 */
export declare function isNativeProject(resources: readonly DiscoveredResource[]): boolean;
/** The program a shell command runs first (`node` for `PORT=1 node server.js`), or null when it cannot be told. */
export declare function commandProgram(command: string): string | null;
