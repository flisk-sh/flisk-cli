#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Validates the adopter rows in docs/project/ADOPTERS.md (#490). A malformed row, a link that is not a
// public URL, a version that was never published, the benchmark fixture or a duplicate organization
// merge silently without it. The check runs in CI when the file changes (the adopters filter in
// .github/workflows/ci.yml); version and link checks talk to the network, so they warn instead of
// failing when the network cannot answer.
//   node scripts/check-adopters.mjs [--root <repo dir>] [--file <markdown>] [--offline]
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY = "https://registry.npmjs.org";
export const PACKAGES = ["@flisk-sh/flisk", "@tdk-landscape/tdk-cli-core"]; // adopter versions predate the flisk rename
export const ADOPTERS_REL = "docs/project/ADOPTERS.md";
export const FORBIDDEN_ORG = "flisk-erp-system";
export const FORBIDDEN_LINK_PART = "benchmarks/results";
const LINK_TIMEOUT_MS = 10_000;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// One adopter row, or why it is not one: { line, cells } for table rows, { line, text } for anything else.
export function tableSection(markdown) {
	const lines = markdown.split("\n");
	const start = lines.findIndex((l) => l.trim() === "## List");
	if (start === -1) return null;
	const rows = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === "") continue; // blank lines in the section are ignored, they do not end the table
		if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) break; // a real ATX heading (hashes then whitespace or end of line) ends the table
		if (line.trimStart().startsWith("|")) {
			const cells = line
				.trim()
				.split("|")
				.map((c) => c.trim());
			// A table row begins and ends with '|', so the split edges are empty; keep them out of the cells.
			if (cells[0] === "") cells.shift();
			if (cells.length && cells[cells.length - 1] === "") cells.pop();
			rows.push({ line: i + 1, cells });
			continue;
		}
		// A non-empty, non-table line inside the List section: usually a row that lost its pipes.
		rows.push({ line: i + 1, text: line });
	}
	return rows;
}

const isHeader = (cells) =>
	cells.length === 3 && cells[0].toLowerCase() === "organization" && cells[2].toLowerCase().includes("version");
const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
const isHttpsUrl = (link) => {
	try {
		const url = new URL(link);
		return url.protocol === "https:" && url.hostname !== "";
	} catch {
		return false;
	}
};
const normalizeOrg = (org) => org.trim().toLowerCase().replace(/\s+/g, " ");

// The offline rules: shape of every row in the table, no network needed.
export function validateRows(rows) {
	const errors = [];
	const seen = new Map();
	for (const row of rows) {
		if (row.text !== undefined) {
			errors.push(`line ${row.line}: not a table row (a row needs | Organization | Link | Flisk version |)`);
			continue;
		}
		if (isHeader(row.cells) || isSeparator(row.cells)) continue;
		const { cells, line } = row;
		if (cells.length !== 3) {
			errors.push(`line ${line}: ${cells.length} columns, expected exactly 3 (Organization, Link, Flisk version)`);
			continue;
		}
		const [org, link, version] = cells;
		if (!org || !link || !version) {
			errors.push(`line ${line}: empty cell (Organization, Link and Flisk version are all required)`);
			continue;
		}
		if (!isHttpsUrl(link)) errors.push(`line ${line}: Link "${link}" is not an https:// URL`);
		if (!VERSION_RE.test(version)) errors.push(`line ${line}: "${version}" is not a released version (x.y.z)`);
		if (normalizeOrg(org) === FORBIDDEN_ORG)
			errors.push(`line ${line}: ${FORBIDDEN_ORG} is the benchmark fixture, not an adopter, and must not be listed`);
		if (link.includes(FORBIDDEN_LINK_PART))
			errors.push(`line ${line}: the link points at ${FORBIDDEN_LINK_PART}, the benchmark fixture, not an adopter`);
		const key = normalizeOrg(org);
		if (seen.has(key)) errors.push(`line ${line}: organization "${org}" duplicates line ${seen.get(key)}`);
		else seen.set(key, line);
	}
	return errors;
}

// Every version in the table must be a published release; only runs with a fetched version set.
export function validateVersions(rows, published) {
	const errors = [];
	for (const row of rows) {
		if (row.text !== undefined || isHeader(row.cells) || isSeparator(row.cells)) continue;
		const version = row.cells[2];
		if (version && VERSION_RE.test(version) && !published.has(version))
			errors.push(`line ${row.line}: version ${version} is not a published Flisk release`);
	}
	return errors;
}

export function publishedVersions(registry, fetchImpl = fetch) {
	const one = (pkg) =>
		fetchImpl(`${registry}/${encodeURIComponent(pkg)}`, { signal: AbortSignal.timeout(LINK_TIMEOUT_MS) }).then(async (res) => {
			if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${pkg}`);
			return Object.keys((await res.json()).versions ?? {});
		});
	// The version column is `flisk --version` output; releases before the rename shipped under the former package name.
	return Promise.all(PACKAGES.map(one)).then((lists) => new Set(lists.flat()));
}

// Reachability is a warning, never an error: private-network and rate-limited hosts must not block a merge.
export function checkLink(row, fetchImpl = fetch) {
	const url = row.cells[1];
	return fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(LINK_TIMEOUT_MS) })
		.then((res) => (res.ok ? null : `line ${row.line}: link ${url} answered ${res.status}`))
		.catch((err) => `line ${row.line}: link ${url} is unreachable (${err.name === "TimeoutError" ? "timeout" : err.message})`);
}

export async function checkAdopters({ markdown, published = null, checkLinks = true, fetchImpl = fetch } = {}) {
	const rows = tableSection(markdown);
	if (rows === null) return { errors: ["no adopter table found under the '## List' heading"], warnings: [] };
	const errors = validateRows(rows);
	const warnings = [];
	if (errors.length === 0) {
		const dataRows = rows.filter((r) => r.text === undefined && !isHeader(r.cells) && !isSeparator(r.cells));
		if (published instanceof Set) errors.push(...validateVersions(dataRows, published));
		if (checkLinks) {
			const linkWarnings = await Promise.all(dataRows.map((row) => checkLink(row, fetchImpl)));
			warnings.push(...linkWarnings.filter(Boolean));
		}
	}
	return { errors, warnings };
}

async function main(argv) {
	const args = [...argv];
	const take = (flag, fallback) => {
		const i = args.indexOf(flag);
		return i === -1 ? fallback : args.splice(i, 2)[1];
	};
	const root = take("--root", path.resolve(fileURLToPath(import.meta.url), "../.."));
	const file = take("--file", path.join(root, ADOPTERS_REL));
	const offline = args.includes("--offline");
	if (!existsSync(file)) {
		console.error(`check-adopters: ${file} does not exist`);
		return 1;
	}
	const markdown = readFileSync(file, "utf8");
	let published = null;
	const warnings = [];
	if (!offline) {
		published = await publishedVersions(process.env.NPM_REGISTRY ?? REGISTRY).catch((err) => {
			warnings.push(`could not verify versions against npm (${err.message}); skipping the published-version check`);
			return null;
		});
	}
	const { errors, warnings: linkWarnings } = await checkAdopters({ markdown, published, checkLinks: !offline });
	warnings.push(...linkWarnings);
	for (const w of warnings) console.warn(`warning: ${w}`);
	for (const e of errors) console.error(`error: ${e}`);
	const rows = (tableSection(markdown) ?? []).filter((r) => r.text === undefined && !isHeader(r.cells) && !isSeparator(r.cells));
	if (errors.length === 0) {
		console.log(`check-adopters: ${rows.length} adopter row(s) in ${path.relative(root, file)} look good`);
		return 0;
	}
	console.error(`check-adopters: ${errors.length} problem(s) in ${path.relative(root, file)}`);
	return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(`check-adopters: ${err.message}`);
			process.exit(1);
		},
	);
}
