// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeSync } from "node:fs";
import { expect, vi } from "vitest";
import { ProcessExitError } from "../utils/errors.js";
/**
 * Builds an in-memory `DiscoveredResource` for pure tests. Nothing is written to disk; the paths are fake.
 * Use `createTempProject` when a test needs real files.
 */
export function makeResource(name, appType, config = {}) {
    return {
        name,
        path: `/tmp/${name}`,
        configPath: `/tmp/${name}/service.json`,
        config: { appName: name, appType, ...config },
    };
}
/**
 * Replaces `process.exit` with a spy that throws. The caller catches the throw, for example with
 * `rejects.toThrow("process.exit")`. Restore it with `vi.restoreAllMocks()` in `afterEach`.
 */
export function captureExit() {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code) => {
        throw new ProcessExitError(code ?? 0);
    }));
    return {
        exit,
        expectExit(code) {
            expect(exit).toHaveBeenCalledTimes(1);
            expect(exit).toHaveBeenCalledWith(code);
        },
    };
}
/**
 * Intercepts `writeSync` so writes to fd 1 (stdout) collect in `chunks` instead of reaching the
 * terminal. The test file must mock `node:fs` `writeSync` as a `vi.fn` first; writes to other
 * descriptors pass through.
 */
export function captureStdoutWrites() {
    const chunks = [];
    const mocked = vi.mocked(writeSync);
    mocked.mockClear();
    mocked.mockImplementation(((fd, data) => {
        if (fd === 1)
            chunks.push(String(data));
        return String(data).length;
    }));
    return {
        chunks,
        text: () => chunks.join(""),
        firstJsonLine: () => chunks.join("").trim().split("\n")[0] ?? "",
    };
}
/**
 * Tracks the "exit" listeners a run registers, so a test can fire them itself and detach the ones
 * still attached afterwards.
 */
export function trackExitListeners() {
    const before = new Set(process.listeners("exit"));
    const added = () => process.listeners("exit").filter((listener) => !before.has(listener));
    return {
        added,
        release: () => {
            for (const listener of added())
                process.removeListener("exit", listener);
        },
    };
}
