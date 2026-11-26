// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createTempProject } from "../../../../test-support/temp-project.js";
/**
 * Registers the cwd restore hook once per suite; the returned factory builds a fresh
 * temp project (and chdirs into it) inside `beforeEach` or a test body.
 */
export function useTempProject() {
    let originalCwd = "";
    beforeEach(() => {
        originalCwd = process.cwd();
    });
    afterEach(() => {
        process.chdir(originalCwd);
    });
    return (spec = {}) => {
        const root = createTempProject(spec);
        process.chdir(root);
        const writeFile = (relativePath, content) => {
            const file = join(root, relativePath);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, content);
        };
        return {
            root,
            writeFile,
            mkdir(relativePath) {
                mkdirSync(join(root, relativePath), { recursive: true });
            },
            writeService(dir, config, files = {}) {
                writeFile(join("services", dir, "service.json"), JSON.stringify({ appName: basename(dir), ...config }));
                for (const [relativePath, content] of Object.entries(files)) {
                    writeFile(join("services", dir, relativePath), content);
                }
            },
        };
    };
}
