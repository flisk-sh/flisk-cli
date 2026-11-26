// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
/** Writes `services/<dir>/service.json` under the project root, as `flisk resource` would. */
export function writeService(root, name, extra = {}, dir = `app/${name}`) {
    const path = join(root, "services", dir);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "service.json"), JSON.stringify({ appName: name, appType: "backend", stack: "app", port: 4000, ...extra }));
}
/** A fresh project root per test, removed afterwards; `service` writes service.json files into it. */
export function tempProject(prefix) {
    const project = {
        root: "",
        service: (name, extra = {}, dir) => writeService(project.root, name, extra, dir),
    };
    beforeEach(() => {
        project.root = mkdtempSync(join(tmpdir(), prefix));
    });
    afterEach(() => {
        rmSync(project.root, { recursive: true, force: true });
    });
    return project;
}
