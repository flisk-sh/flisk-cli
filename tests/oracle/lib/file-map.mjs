// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The file map: every path `flisk project` and `flisk resource` write, who owns it, and whether git carries it to a clone.
// The golden copy is tests/oracle/file-map.json. A pure comparison lives here so it can be unit tested without the CLI.

// Paths with a vendored or per-run number of files collapse into one entry, so a Flisk release that adds an engine file does not
// change the map; a new top-level file or folder does.
const COLLAPSE = [
	[/^\.flisk\/\.flisk-out\/flisk-cli-ext\/.+/, ".flisk/.flisk-out/flisk-cli-ext/**"],
	[/^\.agents\/skills\/[^/]+\/.+/, ".agents/skills/<skill>/**"],
	[/^\.claude\/skills\/.+/, ".claude/skills/**"],
	[/^services\/([^/]+)\/([^/]+)\/src\/.+/, "services/<stack>/<service>/src/**"],
	[/^services\/([^/]+)\/([^/]+)\/tests\/.+/, "services/<stack>/<service>/tests/**"],
	[/^services\/([^/]+)\/([^/]+)\/(.+)$/, "services/<stack>/<service>/$3"],
];

export function collapse(file) {
	if (file.startsWith("services/platform/")) return file; // platform services are Flisk's, not a user stack: keep each path
	for (const [re, to] of COLLAPSE) if (re.test(file)) return file.replace(re, to);
	return file;
}

// tracked: `git ls-files` after `git add -A` (what a push carries). all: also what .gitignore hides.
export function buildMap({ tracked, all }) {
	const trackedSet = new Set(tracked);
	const map = new Map();
	for (const file of all) {
		const key = collapse(file);
		const entry = map.get(key) ?? { tracked: 0, total: 0 };
		entry.total += 1;
		if (trackedSet.has(file)) entry.tracked += 1;
		map.set(key, entry);
	}
	return Object.fromEntries(
		[...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, v]) => [key, v.tracked === 0 ? "ignored" : v.tracked === v.total ? "tracked" : "mixed"]),
	);
}

// A terraform-plan style diff of the golden map against the actual one: `+` is a file Flisk now writes that the map does not know,
// `-` is a mapped file Flisk no longer writes, `~` is a file whose git state changed (tracked <-> ignored).
export function diffMaps(golden, actual) {
	const lines = [];
	for (const key of Object.keys(actual)) if (!(key in golden)) lines.push(`+ ${key}  (${actual[key]})`);
	for (const key of Object.keys(golden)) if (!(key in actual)) lines.push(`- ${key}  (${golden[key].git})`);
	for (const key of Object.keys(actual)) if (key in golden && golden[key].git !== actual[key]) lines.push(`~ ${key}  ${golden[key].git} -> ${actual[key]}`);
	return lines;
}
