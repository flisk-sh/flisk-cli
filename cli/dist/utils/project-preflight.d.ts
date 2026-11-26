/**
 * Check the destinations `flisk project` is about to write before it creates anything (#5419).
 * A broken user-owned manifest or a conflicting file must be a Flisk error, not a raw parse stack
 * followed by a "successful" half-written project.
 */
export declare function preflightProjectFolder(projectRoot: string): void;
