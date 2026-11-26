// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { EventEmitter } from "node:events";

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
export function fakeSpawn(outcome: SpawnOutcome) {
  const calls: unknown[][] = [];
  const spawnFn = ((command: string, args: string[], options: unknown) => {
    calls.push([command, args, options]);
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdout, stderr });
    queueMicrotask(() => {
      if (outcome.error) {
        child.emit("error", outcome.error);
        return;
      }
      if (outcome.stdout) stdout.emit("data", Buffer.from(outcome.stdout));
      if (outcome.stderr) stderr.emit("data", Buffer.from(outcome.stderr));
      child.emit("close", outcome.code);
    });
    return child;
  }) as never;
  return { calls, spawnFn };
}
