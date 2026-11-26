#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Builds the release body of a release in this repository: the signed-checksums paragraph with the cosign
// verify line first, then the merged pull requests since the previous tag, grouped by conventional-commit
// type (gh api repos/<repo>/releases/generate-notes). Called by release-binaries.yml; prints the body on
// stdout. Never fails a release: every problem ends as a stderr warning and the checksum paragraph alone.
//   VERSION=1.4.30 GITHUB_REPOSITORY=flisk-sh/flisk GH_TOKEN=$(gh auth token) node scripts/release-notes.mjs
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.github.com";

// The paragraph Scorecard and verifiers look for, kept byte-for-byte first in the release body.
export function checksumNotes(version) {
	return `Signed checksums for flisk ${version}. The binaries are on https://github.com/flisk-sh/releases/releases/tag/v${version} (all releases: https://github.com/flisk-sh/releases) and the npm package is @flisk-sh/flisk@${version}. Verify with: cosign verify-blob --bundle checksums.txt.sigstore.json --certificate-identity-regexp 'https://github.com/flisk-sh/flisk/.github/workflows/(release-binaries|sign-release)\\.yml@.*' --certificate-oidc-issuer https://token.actions.githubusercontent.com checksums.txt`;
}

// The tag directly below a version among `vX.Y.Z` tags; null when none is lower (the first release).
export function previousTag(tags, version) {
	const [maj, min, pat] = version.split(".").map(Number);
	const below = (tags ?? [])
		.map((tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag))
		.filter((m) => m !== null)
		.map((m) => ({ tag: m[0], parts: [Number(m[1]), Number(m[2]), Number(m[3])] }))
		.filter(
			(t) =>
				t.parts[0] < maj ||
				(t.parts[0] === maj && t.parts[1] < min) ||
				(t.parts[0] === maj && t.parts[1] === min && t.parts[2] < pat),
		)
		.sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
	return below[0]?.tag ?? null;
}

// The merged-pull entries of a generate-notes "What's Changed" section: `* <title> by @<login> in <url>`.
export function parsePulls(generatedBody) {
	const lines = (generatedBody ?? "").split("\n");
	const start = lines.findIndex((line) => /^##\s+What's Changed/i.test(line));
	if (start === -1) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => line.startsWith("## "));
	return (end === -1 ? rest : rest.slice(0, end))
		.filter((line) => line.startsWith("* "))
		.map((line) => {
			const full = /^\*\s+(.*?)\s+by\s+@(\S+)\s+in\s+(https?:\/\/\S+)\s*$/.exec(line);
			if (full) return { title: full[1], login: full[2], url: full[3] };
			const bare = /^\*\s+(.*?)\s+in\s+(https?:\/\/\S+)\s*$/.exec(line);
			return bare
				? { title: bare[1], login: null, url: bare[2] }
				: { title: line.slice(2).trim(), login: null, url: null };
		});
}

const GROUP_ORDER = [
	"Features",
	"Bug Fixes",
	"Performance",
	"Documentation",
	"Tests",
	"CI and Build",
	"Dependencies",
	"Refactoring",
	"Chores",
	"Reverts",
	"Other Changes",
];

const TYPE_TO_HEADING = {
	feat: "Features",
	fix: "Bug Fixes",
	perf: "Performance",
	docs: "Documentation",
	test: "Tests",
	ci: "CI and Build",
	build: "CI and Build",
	deps: "Dependencies",
	dependabot: "Dependencies",
	refactor: "Refactoring",
	chore: "Chores",
	revert: "Reverts",
};

// The conventional-commit type of a pull request title: `feat`, `fix(cli)`, `ci(e2e)!` and so on.
export function pullType(title) {
	const match = /^([\w-]+)(?:\([^)]*\))?!?:/.exec((title ?? "").trim());
	return match ? match[1].toLowerCase() : "other";
}

// Pulls grouped by conventional-commit type, sections ordered as GROUP_ORDER lists them.
export function groupPulls(pulls) {
	const byHeading = new Map(GROUP_ORDER.map((heading) => [heading, []]));
	for (const pull of pulls) {
		const type =
			pull.login === "dependabot[bot]" ? "dependabot" : pullType(pull.title);
		const heading = TYPE_TO_HEADING[type] ?? "Other Changes";
		byHeading.get(heading).push(pull);
	}
	return GROUP_ORDER.filter((heading) => byHeading.get(heading).length > 0).map((heading) => ({
		heading,
		pulls: byHeading.get(heading),
	}));
}

// The full release body: checksum paragraph first, the grouped pull list under it, and the compare link.
export function releaseBody({ version, repo, previous, generatedBody }) {
	const parts = [checksumNotes(version)];
	const groups = groupPulls(parsePulls(generatedBody));
	if (groups.length > 0) {
		const sections = groups
			.map(
				(group) =>
					`### ${group.heading}\n\n${group.pulls
						.map(
							(pull) =>
								`* ${pull.title}${pull.login ? ` by @${pull.login}` : ""}${pull.url ? ` in ${pull.url}` : ""}`,
						)
						.join("\n")}`,
			)
			.join("\n\n");
		parts.push(`## What's Changed\n\n${sections}`);
		if (previous) {
			parts.push(`**Full Changelog**: https://github.com/${repo}/compare/${previous}...v${version}`);
		}
	}
	return `${parts.join("\n\n")}\n`;
}

// Fetches the tag list and the generated notes, then writes the release body to `out`. Never throws.
export async function run({
	version,
	repo = "flisk-sh/flisk",
	token,
	fetchImpl = fetch,
	log = console.error,
	out = process.stdout,
}) {
	const headers = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	let previous = null;
	try {
		const res = await fetchImpl(`${API}/repos/${repo}/tags?per_page=100`, { headers });
		if (res.ok) {
			previous = previousTag((await res.json()).map((tag) => tag.name), version);
		} else {
			log(`::warning::Could not list tags for ${repo}: HTTP ${res.status}`);
		}
	} catch (error) {
		log(`::warning::Could not list tags for ${repo}: ${error.message}`);
	}
	let generatedBody = "";
	try {
		const res = await fetchImpl(`${API}/repos/${repo}/releases/generate-notes`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				tag_name: `v${version}`,
				...(previous ? { previous_tag_name: previous } : {}),
			}),
		});
		if (res.ok) {
			generatedBody = (await res.json()).body ?? "";
		} else {
			log(`::warning::generate-notes for v${version} on ${repo}: HTTP ${res.status}`);
		}
	} catch (error) {
		log(`::warning::generate-notes for v${version} on ${repo}: ${error.message}`);
	}
	out.write(releaseBody({ version, repo, previous, generatedBody }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await run({
		version:
			process.env.VERSION ??
			process.env.RELEASE_VERSION ??
			JSON.parse(readFileSync("package.json", "utf8")).version,
		repo: process.env.GITHUB_REPOSITORY ?? "flisk-sh/flisk",
		token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
	});
}
