#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Fails when a section heading in docs/CHANGELOG.md is not "## x.y.z (yyyy-mm-dd)" (or "## Unreleased" /
// "## Earlier"). Release 1.4.67's version bump was done by hand and wrote "## 2026-11-16 (undefined)"
// (#5282), the same empty-argv failure that put "undefined" into package.json for 1.4.66 (#4320).
//   node scripts/check-changelog.mjs [--root <repo dir>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HEADING = /^## (Unreleased|Earlier|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \(\d{4}-\d{2}-\d{2}\))$/;

// Problems for changelog text; empty when every "## " heading is well-formed.
export function problems(changelog) {
	const out = [];
	changelog.split("\n").forEach((line, i) => {
		const trimmed = line.trimEnd();
		if (trimmed.startsWith("## ") && !HEADING.test(trimmed)) {
			out.push(`line ${i + 1}: heading is ${JSON.stringify(trimmed)}, expected "## x.y.z (yyyy-mm-dd)"`);
		}
	});
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf("--root");
	const root = i > 0 ? process.argv[i + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const found = problems(readFileSync(path.join(root, "docs", "CHANGELOG.md"), "utf8"));
	if (found.length) {
		for (const p of found) console.error(`check-changelog: ${p}`);
		process.exit(1);
	}
	console.log("check-changelog: ok");
}
