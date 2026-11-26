// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { FliskError } from "./errors.js";
function real(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return resolve(path);
    }
}
/**
 * Resolves a path given on the command line (or by a calling agent) and refuses a NUL byte or a
 * target outside the working directory, home directory and temp directory. Symlinks are resolved
 * through the nearest existing parent, so a linked directory cannot hide a target outside those roots.
 * Containment is a prefix check on the resolved path.
 */
export function safeCliPath(input, label) {
    if (input === "" || input.includes("\0")) {
        throw new FliskError(`${label} must be a non-empty path without NUL bytes`, [
            `Pass a normal file path to ${label}`,
        ]);
    }
    const abs = resolve(input);
    let probe = abs;
    let tail = "";
    for (;;) {
        try {
            realpathSync(probe);
            break;
        }
        catch {
            const parent = dirname(probe);
            if (parent === probe)
                break;
            tail = tail
                ? `${probe.slice(parent.length + 1)}${sep}${tail}`
                : probe.slice(parent.length + 1);
            probe = parent;
        }
    }
    const target = tail ? resolve(real(probe), tail) : real(probe);
    const inside = [process.cwd(), homedir(), tmpdir()].some((root) => {
        const base = real(root);
        return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
    });
    if (!inside) {
        throw new FliskError(`${label} ${input} is outside the working, home and temp directories`, [
            `Give ${label} a path under the current directory, your home directory or the temp directory`,
        ]);
    }
    return target;
}
