/**
 * Shared fakes for the `flisk os` tests: a machine described as a `FliskOsHost` and a `spawn` double that records its
 * calls and plays back a script once the caller has attached its listeners.
 */
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { FliskOsHost } from "../os.js";
/** The line a `fliskos` stub prints once it listens, exactly as the real one does. */
export declare const RUNNING = "FliskOS is running at http://127.0.0.1:4321\n";
/** A macOS machine with nothing on it; describe one with overrides. */
export declare function host(overrides?: Partial<FliskOsHost>): FliskOsHost;
/** A machine whose PATH has `fliskos` at `path` (and nothing else). */
export declare const onPath: (path: string) => FliskOsHost;
export type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
};
export interface SpawnCall {
    command: string;
    args: string[];
    options: SpawnOptions;
    child: FakeChild;
}
/** A spawn double. `script` runs once the caller has attached its listeners, and decides how the child behaves. */
export declare function fakeSpawn(script?: (child: FakeChild) => void): {
    calls: SpawnCall[];
    spawnFn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
};
