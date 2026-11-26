/** What a spawn-double child does once the caller has attached its listeners. */
export interface SpawnOutcome {
    /** Exit code reported through `close`; `null` and `undefined` reach the caller as `code ?? 1`. */
    code?: number | null;
    /** Text the child's piped stdout emits before it closes. */
    stdout?: string;
    /** Text the child's piped stderr emits before it closes. */
    stderr?: string;
    /** When set, the child fails to start: it emits `error` and never closes. */
    error?: Error;
}
/**
 * A spawn double whose piped child prints `stdout` and `stderr` on the next microtask, then closes
 * with `code` — or fails to start with `error`. `calls` records `[command, args, options]` for
 * every spawned child.
 */
export declare function fakeSpawn(outcome: SpawnOutcome): {
    calls: unknown[][];
    spawnFn: never;
};
