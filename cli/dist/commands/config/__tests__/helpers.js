// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as path from "node:path";
/** A minimal valid `.flisk/project.json` body for the config command's extracted modules. */
export const configProjectJson = (name = "config-modules", optionalInfra = {}) => ({
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
        ...optionalInfra,
    },
    discovery: { paths: ["services/*/*"] },
});
/** Reads `.flisk/project.json` back from a temp project root. */
export const readProjectJson = (root) => JSON.parse(fs.readFileSync(path.join(root, ".flisk", "project.json"), "utf-8"));
/** Runs `fn` with `process.cwd()` inside `root` so `findProjectRoot` resolves the temp project. */
export async function inProject(root, fn) {
    const before = process.cwd();
    process.chdir(root);
    try {
        return await fn();
    }
    finally {
        process.chdir(before);
    }
}
