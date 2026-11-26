import { EventEmitter } from "node:events";
import { vi } from "vitest";
/** The line a `fliskos` stub prints once it listens, exactly as the real one does. */
export const RUNNING = "FliskOS is running at http://127.0.0.1:4321\n";
/** A macOS machine with nothing on it; describe one with overrides. */
export function host(overrides = {}) {
    return {
        platform: "darwin",
        home: "/Users/test",
        findCommand: () => null,
        exists: () => false,
        ...overrides,
    };
}
/** A machine whose PATH has `fliskos` at `path` (and nothing else). */
export const onPath = (path) => host({ findCommand: (name) => (name === "fliskos" ? path : null) });
/** A spawn double. `script` runs once the caller has attached its listeners, and decides how the child behaves. */
export function fakeSpawn(script = (child) => child.emit("close", 0)) {
    const calls = [];
    const spawnFn = ((command, args, options) => {
        const child = Object.assign(new EventEmitter(), {
            stdout: new EventEmitter(),
            kill: vi.fn(),
        });
        calls.push({ command, args, options, child });
        queueMicrotask(() => script(child));
        return child;
    });
    return { calls, spawnFn };
}
