import { EventEmitter } from "node:events";
import type { Command } from "commander";
import { type Mock } from "vitest";
import { createFliskTools, type FliskRun, type UpDeps } from "../../tools.js";
export declare function getSpawnMock(): Mock;
export declare function resetSpawnMock(): void;
export declare function createProjectFixture(): {
    readonly projectDir: string;
    readonly notADirectory: string;
};
export declare function recordingTools(stdout: string, result?: Partial<FliskRun>, up?: UpDeps): {
    seen: {
        args: string[];
        cwd?: string;
        timeoutMs?: number;
    }[];
    tools: ReturnType<typeof createFliskTools>;
};
export declare function loadRegisteredCommandMap(): Map<string, Command>;
type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: Mock;
    pid: number;
};
export declare function fakeChild(): FakeChild;
export declare function fakeUp(options: {
    logs: string[];
    exitAfter?: {
        atRead: number;
        code: number;
    };
}): {
    deps: UpDeps;
    child: EventEmitter & {
        pid: number;
        unref: () => void;
    };
    logFile: string;
};
export {};
