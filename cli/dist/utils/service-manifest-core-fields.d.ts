export declare function getInvalidServiceRoutePathFields(value: unknown): ("apiPath" | "basePath")[];
/**
 * An appType outside the published enum, or a port that is not an integer from PORT_MIN to PORT_MAX
 * (the shared rule-table bound, service-manifest-rules.ts). Tilt discovery only logs these as
 * warnings during `flisk up` (runtime/discovery/validation.star), so `flisk config verify` reports them first. The schema's
 * per-appType port ranges are not applied here: discovery uses different ranges, so the shared bound is the one both accept.
 */
export declare function appTypeAndPortErrors(manifest: Record<string, unknown>, displayPath: string): string[];
