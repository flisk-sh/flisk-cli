// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Resolves a path given on a command line (or by a calling agent) and refuses anything outside the places these
// benchmark scripts may read and write: the current directory, the repository, the home directory and the temp directory.
// A `..` segment, a NUL byte or a symlink that leaves those roots is an error, not a silent redirect.

import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function real(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function inside(root, target) {
	// Containment as a prefix check on the resolved path, the form static analyzers recognise as a path sanitizer.
	const base = real(root);
	return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function safePath(input, label = "path") {
	if (typeof input !== "string" || input === "" || input.includes("\0")) {
		throw new Error(`${label}: expected a non-empty path without NUL bytes`);
	}
	const abs = resolve(input);
	// Resolve the nearest existing parent so a symlinked directory cannot hide a target outside the roots.
	let probe = abs;
	let tail = "";
	for (;;) {
		try {
			realpathSync(probe);
			break;
		} catch {
			const parent = dirname(probe);
			if (parent === probe) break;
			tail = tail ? `${probe.slice(parent.length + 1)}/${tail}` : probe.slice(parent.length + 1);
			probe = parent;
		}
	}
	const target = tail ? resolve(real(probe), tail) : real(probe);
	if (![process.cwd(), repoRoot, homedir(), tmpdir()].some((root) => inside(root, target))) {
		throw new Error(`${label}: ${input} is outside the working directory, repository, home and temp directories`);
	}
	return target;
}
