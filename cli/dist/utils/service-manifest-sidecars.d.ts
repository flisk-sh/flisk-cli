/**
 * `sidecarOf` (#2908): a bring-your-own resource that shares another resource's network namespace. Mirrors
 * engine/.../compose/byo_sidecar.star. Whether the host exists in the same stack is checked across services (checkSidecars).
 */
export declare function sidecarErrors(manifest: Record<string, unknown>, displayPath: string): string[];
