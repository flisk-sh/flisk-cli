// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * Shared fakes for the `flisk os` tests: a machine described as a `FliskOsHost` and a `spawn` double that records its
 * calls and plays back a script once the caller has attached its listeners.
 */
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { FliskOsHost, OsDeps } from "../os.js";

/** The line a `fliskos` stub prints once it listens, exactly as the real one does. */
export const RUNNING = "FliskOS is running at http://127.0.0.1:4321\n";

/** A macOS machine with nothing on it; describe one with overrides. */
export function host(overrides: Partial<FliskOsHost> = {}): FliskOsHost {
  return {
    platform: "darwin",
    home: "/Users/test",
    findCommand: () => null,
    exists: () => false,
    ...overrides,
  };
}

/** A machine whose PATH has `fliskos` at `path` (and nothing else). */
export const onPath = (path: string) =>
  host({ findCommand: (name) => (name === "fliskos" ? path : null) });

export type FakeChild = EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };

export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
}

/** A spawn double. `script` runs once the caller has attached its listeners, and decides how the child behaves. */
export function fakeSpawn(script: (child: FakeChild) => void = (child) => child.emit("close", 0)) {
  const calls: SpawnCall[] = [];
  const spawnFn = ((command: string, args: string[], options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      kill: vi.fn(),
    }) as FakeChild;
    calls.push({ command, args, options, child });
    queueMicrotask(() => script(child));
    return child as unknown as ChildProcess;
  }) as OsDeps["spawn"];
  return { calls, spawnFn };
}
