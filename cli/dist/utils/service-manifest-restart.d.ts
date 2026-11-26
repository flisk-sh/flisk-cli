/**
 * `restart` on a bring-your-own resource: no, on-failure, on-failure:N (N from 1 to 100), unless-stopped or always. Mirrors
 * byo_restart_policy in engine/.../compose/byo_container.star.
 */
export declare function restartErrors(manifest: Record<string, unknown>, displayPath: string): string[];
