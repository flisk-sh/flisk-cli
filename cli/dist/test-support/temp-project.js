// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { onTestFinished } from "vitest";
/** Minimal valid `.flisk/project.json` for tests that only care about generated-file drift. */
export function projectJsonFixture(name) {
    return {
        version: "1.0",
        project: { name, version: "1.0.0" },
        phases: Object.fromEntries(["pre_alpha", "alpha", "beta", "out_of_scope"].map((phase) => [
            phase,
            { name: phase, description: "", enabledStacks: [] },
        ])),
        optional_infra: {
            monitoring: false,
            elk: false,
            debezium: false,
            golden_image: false,
            verdaccio: false,
        },
        discovery: { paths: ["services/*/*"] },
    };
}
function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}
function serialize(spec, defaults) {
    return typeof spec === "string" ? spec : JSON.stringify({ ...defaults, ...spec });
}
/** Best-effort removal: Windows can keep a fresh temp dir locked past the test (AV, Search indexer). */
function removeTempTreeBestEffort(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    }
    catch (error) {
        if (process.platform !== "win32")
            throw error;
    }
}
/**
 * Creates a temporary flisk project on disk and returns its real path. It is removed when the current test finishes.
 * Call it from inside a test or a `beforeEach`.
 */
export function createTempProject(spec = {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flisk-test-project-")));
    onTestFinished(() => {
        removeTempTreeBestEffort(root);
    });
    const { projectJson = {} } = spec;
    if (projectJson !== null) {
        write(path.join(root, ".flisk", "project.json"), typeof projectJson === "string" ? projectJson : `${JSON.stringify(projectJson)}\n`);
    }
    for (const [stack, apps] of Object.entries(spec.stacks ?? {})) {
        for (const [app, service] of Object.entries(apps)) {
            write(path.join(root, "services", stack, app, "service.json"), serialize(service, { appName: app, stack }));
        }
    }
    for (const [dir, service] of Object.entries(spec.resources ?? {})) {
        write(path.join(root, "services", dir, "service.json"), serialize(service, { appName: path.basename(dir) }));
    }
    const generated = spec.generated ?? {};
    const generatedFiles = Array.isArray(generated)
        ? Object.fromEntries(generated.map((name) => [name, ""]))
        : generated;
    for (const [name, content] of Object.entries(generatedFiles)) {
        write(path.join(root, ".flisk", ".flisk-out", name), content);
    }
    for (const [relative, content] of Object.entries(spec.files ?? {})) {
        write(path.join(root, relative), content);
    }
    return root;
}
/**
 * A `.flisk/project.json` body that passes validation: the four phases and the optional_infra
 * flags with every discovery root covered by `discoveryPaths`.
 */
export function validProjectJson(options) {
    const { name, version = "1.0.0", discoveryPaths } = options;
    return {
        version,
        project: { name, version: "1.0.0" },
        phases: Object.fromEntries(["pre_alpha", "alpha", "beta", "out_of_scope"].map((phaseName) => [
            phaseName,
            { name: phaseName, description: "", enabledStacks: [] },
        ])),
        optional_infra: {
            monitoring: false,
            elk: false,
            debezium: false,
            golden_image: false,
            verdaccio: false,
        },
        discovery: { paths: discoveryPaths },
    };
}
/** Creates an empty temporary directory that is removed when the current test finishes. */
export function createTempDir(prefix = "flisk-test-dir-") {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    onTestFinished(() => {
        removeTempTreeBestEffort(dir);
    });
    return dir;
}
