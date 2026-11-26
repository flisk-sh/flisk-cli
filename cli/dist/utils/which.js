// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { isWindows, pathLookups } from "./platform.js";
export function findOnPath(command, pathEnv = process.env.PATH ?? process.env.Path ?? "", platform = process.platform) {
    const windows = platform === "win32";
    const names = pathLookups(command, windows);
    if (windows && !extname(command)) {
        for (const extension of (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")) {
            const suffix = extension.toLowerCase();
            if (suffix && !names.includes(`${command}${suffix}`))
                names.push(`${command}${suffix}`);
        }
    }
    for (const dir of pathEnv.split(delimiter)) {
        if (!dir)
            continue;
        for (const name of names) {
            const candidate = join(dir, name);
            if (existsSync(candidate))
                return candidate;
        }
    }
    return null;
}
/**
 * The JavaScript package managers a generated package.json can install and run through, most common
 * first. `bun run` covers the `node` calls and `#!/usr/bin/env node` bins inside scripts itself, so a
 * machine with only Bun needs nothing else; npm, pnpm and yarn are Node programs.
 */
export const JS_PACKAGE_MANAGERS = ["npm", "bun", "pnpm", "yarn"];
/**
 * The package manager a scaffolded package.json installs and runs with: the first one on this
 * machine, npm when none is found (the missing-program check then reports it, as before).
 */
export function localPackageManager(onPath = (program) => findOnPath(program) !== null) {
    return JS_PACKAGE_MANAGERS.find((manager) => onPath(manager)) ?? "npm";
}
export function findAllOnPath(command) {
    const pathEnv = process.env.PATH ?? process.env.Path ?? "";
    const windows = isWindows();
    const names = pathLookups(command, windows);
    if (windows && !extname(command)) {
        for (const extension of (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")) {
            const suffix = extension.toLowerCase();
            if (suffix && !names.includes(`${command}${suffix}`))
                names.push(`${command}${suffix}`);
        }
    }
    const found = [];
    const seen = new Set();
    for (const dir of pathEnv.split(delimiter)) {
        if (!dir)
            continue;
        for (const name of names) {
            const candidate = join(dir, name);
            if (!existsSync(candidate))
                continue;
            const key = windows ? candidate.toLowerCase() : candidate;
            if (!seen.has(key)) {
                seen.add(key);
                found.push(candidate);
            }
        }
    }
    return found;
}
