// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { EventEmitter } from "node:events";
/**
 * A spawn double whose piped child prints `stdout` and `stderr` on the next microtask, then closes
 * with `code` — or fails to start with `error`. `calls` records `[command, args, options]` for
 * every spawned child.
 */
export function fakeSpawn(outcome) {
    const calls = [];
    const spawnFn = ((command, args, options) => {
        calls.push([command, args, options]);
        const stdout = new EventEmitter();
        const stderr = new EventEmitter();
        const child = Object.assign(new EventEmitter(), { stdout, stderr });
        queueMicrotask(() => {
            if (outcome.error) {
                child.emit("error", outcome.error);
                return;
            }
            if (outcome.stdout)
                stdout.emit("data", Buffer.from(outcome.stdout));
            if (outcome.stderr)
                stderr.emit("data", Buffer.from(outcome.stderr));
            child.emit("close", outcome.code);
        });
        return child;
    });
    return { calls, spawnFn };
}
