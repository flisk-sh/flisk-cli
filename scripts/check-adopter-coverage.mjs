#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Checks docs/project/ADOPTER-COVERAGE.md: a row that ties a release version to pull request
// numbers must hold against the real git tags and the real npm package. A "fixed in 1.4.30 (#3010)"
// is wrong when v1.4.30 does not contain #3010's merge commit or when npm has no 1.4.30 package;
// that is the class of mistake this guards (#3063).
//
// Two spellings are read:
// - a `fixed in X.Y.Z (...)` clause: every #NNNN inside its parentheses pairs with X.Y.Z. Version
//   numbers elsewhere in the cell ("the npm 1.4.30 package was built before #3025") are context,
//   not claims.
// - a row of a table whose header has a `Since` column, holding one bare version there plus #NNNN
//   anywhere in the row: each #NNNN pairs with that version. Rows that name several versions in
//   the cell are skipped, because which version covers which fix cannot be told apart.
//
// For every (version, #pr) pair the PR's merge commit comes from the GitHub API (`gh`, then the
// public REST endpoint; a (#NNNN) commit-subject guess is the offline last resort, since a docs
// commit can carry the same marker). `git tag --contains` must list v<version>, and the version
// must also be on npm as @flisk-sh/flisk@<version>. A failure prints the row, what was claimed
// and the first tag that does contain the commit.
//
// Needs a full fetch: on a shallow checkout (no tags, no deep history) `git tag --contains` cannot
// see the merge commits and the check reports that instead of guessing. ci.yml runs it with
// fetch-depth: 0.
//   node scripts/check-adopter-coverage.mjs [--file <markdown>] [--root <repo dir>] [--repo <owner/name>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = "docs/project/ADOPTER-COVERAGE.md";
const NPM_PACKAGE = "@flisk-sh/flisk";
const UPSTREAM_REPO = "flisk-sh/flisk";

// Bounded digit runs keep the scan linear: on a long run of digits an open-ended \d+ retries
// every length at every position before the dot fails (javascript:S8786). Five digits per part
// is far beyond any segment a real semver carries here.
const SEMVER = /\d{1,5}\.\d{1,5}\.\d{1,5}/g;
const FIXED_IN = /fixed in (\d+\.\d+\.\d+)\s*\(([^)]*)\)/g;
const PR_REF = /#(\d+)/g;

/**
 * `name` as a fixed path, found by the same PATH walk the OS does, so the spawn calls below hand
 * execFileSync a resolved binary instead of a PATH search (javascript:S4036). A name PATH has no
 * match for falls back to the bare name, which fails the way it always did.
 */
function commandPath(name, pathEnv = process.env.PATH ?? "") {
	const names =
		process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`] : [name];
	for (const dir of pathEnv.split(path.delimiter)) {
		if (!dir) continue;
		for (const candidate of names) {
			const file = path.join(dir, candidate);
			if (existsSync(file)) return file;
		}
	}
	return name;
}

const git = (root, args) =>
	execFileSync(commandPath("git"), ["-C", root, ...args], { encoding: "utf8" }).trim();

// Every (version, prs) claim in the file, in file order. `row` is the trimmed table row, for
// failure output.
export function parsePairs(markdown) {
	const pairs = [];
	const lines = markdown.split("\n");
	// The header position of the current table's Since column, if the table has one. -1 disables
	// the generic pairing; the index positions the cell split the same way the row splits.
	let sinceColumn = -1;
	for (const line of lines) {
		if (!line.trimStart().startsWith("|")) {
			sinceColumn = -1;
			continue;
		}
		const cells = line.split("|").slice(1, -1).map((c) => c.trim());
		if (cells.some((c) => /^Since\b/.test(c))) {
			sinceColumn = cells.findIndex((c) => /^Since\b/.test(c));
			continue;
		}
		if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // the |---| separator
		const row = line.trim();
		let claimed = false;
		for (const m of line.matchAll(FIXED_IN)) {
			claimed = true;
			const prs = [...new Set([...m[2].matchAll(PR_REF)].map((p) => Number(p[1])))];
			if (prs.length > 0) pairs.push({ version: m[1], prs, row });
		}
		if (claimed || sinceColumn < 0 || sinceColumn >= cells.length) continue;
		const versions = [...cells[sinceColumn].matchAll(SEMVER)].map((v) => v[0]);
		const prs = [...line.matchAll(PR_REF)].map((p) => Number(p[1]));
		if (versions.length === 1 && prs.length > 0) {
			pairs.push({ version: versions[0], prs, row });
		}
	}
	return pairs;
}

// Map PR number -> commit, from subjects that end with " (#NNNN)" the way GitHub titles
// squash-merge commits. A guess only: a docs commit can carry the same marker, so the GitHub
// API's merge_commit_sha is always preferred.
export function mergeCommitsByPr(logLines) {
	const map = new Map();
	for (const line of logLines.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab < 0) continue;
		const sha = line.slice(0, tab);
		const m = line.slice(tab + 1).match(/\(#(\d+)\)\s*$/);
		if (m && !map.has(Number(m[1]))) map.set(Number(m[1]), sha);
	}
	return map;
}

// One pair -> a failure string, or null when it checks out. `deps` makes the git and npm boundary
// injectable so the unit test needs no repository, tags or network.
export function checkPair(pair, pr, deps) {
	const sha = deps.mergeCommit(pr);
	if (!sha) {
		return `${pair.row}\n  #${pr}: merge commit not found; check the PR number, and run on a full fetch (fetch-depth: 0)`;
	}
	const tags = deps.tagsContaining(sha);
	const wanted = `v${pair.version}`;
	if (!tags.includes(wanted)) {
		const first = tags[0] ?? "none";
		return `${pair.row}\n  claims ${pair.version} for #${pr}, but ${wanted} does not contain ${sha.slice(0, 12)}; first tag that does: ${first}`;
	}
	if (!deps.npmVersions.has(pair.version)) {
		return `${pair.row}\n  claims ${pair.version} for #${pr}; ${wanted} contains the commit but npm has no ${NPM_PACKAGE}@${pair.version}`;
	}
	return null;
}

export function run(root, file, deps) {
	const markdown = readFileSync(path.join(root, file), "utf8");
	const pairs = parsePairs(markdown);
	const failures = [];
	let checked = 0;
	for (const pair of pairs) {
		for (const pr of pair.prs) {
			checked += 1;
			const failure = checkPair(pair, pr, deps);
			if (failure) failures.push(failure);
		}
	}
	return { pairs, checked, failures };
}

function ghApiMergeCommit(repo, pr) {
	try {
		const out = execFileSync(
			commandPath("gh"),
			["api", `repos/${repo}/pulls/${pr}`, "--jq", ".merge_commit_sha"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		return /^[0-9a-f]{40}$/.test(out) ? out : null;
	} catch {
		return null;
	}
}

async function restMergeCommit(repo, pr) {
	const headers = {
		Accept: "application/vnd.github+json",
		"User-Agent": "flisk-check-adopter-coverage",
	};
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
		headers,
	});
	if (!res.ok) return null;
	const data = await res.json();
	return typeof data.merge_commit_sha === "string" ? data.merge_commit_sha : null;
}

async function resolveMergeCommits(repo, prs, root) {
	const resolved = new Map();
	const missing = [];
	await Promise.all(
		prs.map(async (pr) => {
			const sha = ghApiMergeCommit(repo, pr) ?? (await restMergeCommit(repo, pr));
			if (sha) resolved.set(pr, sha);
			else missing.push(pr);
		}),
	);
	if (missing.length === 0) return resolved;
	// Offline or rate-limited: fall back to the (#NNNN) subject guess for whatever is still open.
	const byPr = mergeCommitsByPr(git(root, ["log", "--all", "--format=%H%x09%s"]));
	for (const pr of missing) {
		if (byPr.has(pr)) resolved.set(pr, byPr.get(pr));
	}
	return resolved;
}

async function liveDeps(root, repo, prs) {
	const commits = await resolveMergeCommits(repo, prs, root);
	return {
		mergeCommit: (pr) => commits.get(pr) ?? null,
		tagsContaining: (sha) =>
			git(root, ["tag", "--contains", sha, "--sort=v:refname"])
				.split("\n")
				.map((t) => t.trim())
				.filter(Boolean),
		npmVersions: new Set(
			JSON.parse(
				execFileSync(commandPath("npm"), ["view", NPM_PACKAGE, "versions", "--json"], {
					encoding: "utf8",
				}).trim(),
			),
		),
	};
}

async function main() {
	const args = process.argv.slice(2);
	let file = DEFAULT_FILE;
	let root = path.resolve(SCRIPT_DIR, "..");
	let repo = UPSTREAM_REPO;
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === "--file") file = args[++i];
		else if (args[i] === "--root") root = path.resolve(args[++i]);
		else if (args[i] === "--repo") repo = args[++i];
		else {
			console.error(
				"usage: node scripts/check-adopter-coverage.mjs [--file <markdown>] [--root <repo dir>] [--repo <owner/name>]",
			);
			process.exit(2);
		}
	}
	const pairs = parsePairs(readFileSync(path.join(root, file), "utf8"));
	const prs = [...new Set(pairs.flatMap((p) => p.prs))];
	let deps;
	try {
		deps = await liveDeps(root, repo, prs);
	} catch (err) {
		console.error(
			`check-adopter-coverage: could not read git history, tags or the npm registry:\n${err.message}`,
		);
		process.exit(2);
	}
	const { checked, failures } = run(root, file, deps);
	for (const failure of failures) console.error(`FAIL ${failure}`);
	console.log(
		`check-adopter-coverage: ${checked} version/PR pair${checked === 1 ? "" : "s"} checked across ${pairs.length} row${pairs.length === 1 ? "" : "s"}, ${failures.length} failure${failures.length === 1 ? "" : "s"}`,
	);
	process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	await main();
}
