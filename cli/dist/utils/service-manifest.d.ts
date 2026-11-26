import type { DiscoveredResource } from "../types/index.js";
import { buildArgsErrors, envFileErrors, loggingErrors } from "./service-manifest-build-env.js";
import { configsErrors } from "./service-manifest-configs.js";
import { containerErrors } from "./service-manifest-container.js";
import { appTypeAndPortErrors, getInvalidServiceRoutePathFields } from "./service-manifest-core-fields.js";
import { dependsOnErrors } from "./service-manifest-depends-on.js";
import { dockerNameErrors } from "./service-manifest-docker-name.js";
import { fieldTypeErrors } from "./service-manifest-field-types.js";
import { validateGeneratedStringFields } from "./service-manifest-generated-fields.js";
import { healthCheckErrors } from "./service-manifest-health.js";
import { extraPortsErrors } from "./service-manifest-ports.js";
import { byoEnvErrors, modelsErrors, providersErrors, providesErrors } from "./service-manifest-providers.js";
import { restartErrors } from "./service-manifest-restart.js";
import { secretConflictWarnings, secretsErrors } from "./service-manifest-secrets.js";
import { sidecarErrors } from "./service-manifest-sidecars.js";
import { volumesErrors } from "./service-manifest-volumes.js";
import { webUiErrors } from "./service-manifest-web-ui.js";
export { isDockerSafeName } from "./service-manifest-docker-name.js";
export { isAbsoluteBuildPath } from "./service-manifest-field-types.js";
export { BASE_PATH_PATTERN, generatedFieldErrorsForFile, } from "./service-manifest-generated-fields.js";
export { HEALTH_PATH_PATTERN, healthCheckPathOf, isHealthCheckDisabled, isHealthCheckOptional, type ParsedHealthCheckConfig, parseHealthCheckConfig, type ReadinessProbe, readinessProbeOf, } from "./service-manifest-health.js";
export { type ProviderSpec, providersOf } from "./service-manifest-providers.js";
export { appTypeAndPortErrors, buildArgsErrors, byoEnvErrors, configsErrors, containerErrors, dependsOnErrors, dockerNameErrors, envFileErrors, extraPortsErrors, fieldTypeErrors, getInvalidServiceRoutePathFields, healthCheckErrors, loggingErrors, modelsErrors, providersErrors, providesErrors, restartErrors, secretConflictWarnings, secretsErrors, sidecarErrors, validateGeneratedStringFields, volumesErrors, webUiErrors, };
export declare const SERVICE_MANIFEST_SCHEMA_VERSION = 1;
export declare const SERVICE_MANIFEST_SCHEMA_URL = "https://flisk.sh/schema.service.json";
/**
 * A top-level service.json key Flisk does not read that sits within the suggestion edit distance of a
 * field it does (a `comand` for `command`, or a case-only `healthcheckpath` for `healthCheckPath`).
 * The field is ignored, so the service silently loses what the key meant.
 */
export interface ManifestFieldTypo {
    field: string;
    suggestion: string;
}
/** The near-miss unknown keys of one manifest, in file order. */
export declare function manifestFieldTypos(manifest: Record<string, unknown>): ManifestFieldTypo[];
/**
 * One line per near-miss key across the discovered services, for an error such a key may have
 * caused: a `comand` hides `command`, so a service meant to run as a local process reads as a
 * Docker service and `flisk up` or `flisk doctor` then blames Docker instead of the typo.
 */
export declare function serviceManifestTypoNotes(resources: readonly DiscoveredResource[]): string[];
export interface ServiceManifestValidation {
    errors: string[];
    warnings: string[];
    manifest?: Record<string, unknown>;
}
/**
 * Reserved infrastructure names in an existing service.json, so `flisk config verify` says why the name is bad before
 * `flisk up` fails inside Tilt. BYO imports may deliberately use a fixed container name (the engine already avoids
 * registering a second shared Postgres for them), and a local process never reaches Tilt, so neither clashes.
 */
export declare function reservedInfrastructureNameErrors(manifest: Record<string, unknown>, displayPath: string): string[];
export declare function validateServiceManifest(value: unknown, displayPath: string): ServiceManifestValidation;
export declare function validateServiceManifestFile(filePath: string, displayPath: string): ServiceManifestValidation;
