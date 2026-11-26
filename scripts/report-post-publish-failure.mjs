#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Files one issue per version when the post-publish-smoke job in release-binaries.yml fails
// (#3090): the published @flisk-sh/flisk@<version> did not install, did not run, or did not carry
// the released commit's build. A re-run that fails again comments on the same issue instead of
// opening another, and a repair run that passes closes nothing by itself; a human closes it.
//   node scripts/report-post-publish-failure.mjs --version <v> --commit <sha> --run-url <url> [--dry-run]
import { fileURLToPath } from "node:url";
import { canonicalIssue, issueApi } from "./report-post-merge-failures.mjs";

export function issueTitle(version) {
	return `Post-publish npm smoke failed: @flisk-sh/flisk@${version}`;
}

export function issueBody({ version, commit, runUrl }) {
	return [
		`The post-publish smoke check failed for \`@flisk-sh/flisk@${version}\`, published from commit ${commit}.`,
		"",
		"The `post-publish-smoke` job installs the published package the way users do (`npm i -g @flisk-sh/flisk`),",
		"runs `flisk --version`, and checks that `cli/dist-bundle` carries this commit's build marker. Its failure",
		"means the version on npm is broken or is not the build the tag describes.",
		"",
		`Run: ${runUrl}`,
		"",
		`The version is already live on npm. Decide between \`npm deprecate\` plus a fixed next release and a repair`,
		"per docs/releasing.md#repair-a-half-finished-release. Each failing re-run adds a comment here.",
	].join("\n");
}

// The job can be re-run while an earlier issue is still open: create when none matches the title,
// otherwise comment the new run on the existing one. Creating twice races, so a creator re-lists and
// closes its own issue when an older one appeared, converging on the oldest (report-post-merge-failures).
export function fileIssue({ version, commit, runUrl }, api) {
	const title = issueTitle(version);
	const line = `Failed again: ${runUrl}`;
	const existing = canonicalIssue(api.list(), title);
	if (existing !== null) {
		api.comment(existing, line);
		return existing;
	}
	const created = api.create(title, issueBody({ version, commit, runUrl }));
	const canonical = canonicalIssue(api.list(), title) ?? created;
	if (canonical === created) return created;
	api.comment(canonical, line);
	api.close(created, canonical);
	return canonical;
}

function main(argv) {
	const flag = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	const version = flag("--version") || process.env.NPM_VERSION;
	const commit = flag("--commit") || process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA;
	const runUrl = flag("--run-url") || process.env.RUN_URL;
	if (!version || !commit || !runUrl) {
		console.error("usage: report-post-publish-failure.mjs --version <v> --commit <sha> --run-url <url> [--dry-run]");
		return 2;
	}
	if (argv.includes("--dry-run")) {
		console.log(`would file issue "${issueTitle(version)}" for ${runUrl}`);
		return 0;
	}
	const number = fileIssue({ version, commit, runUrl }, issueApi);
	console.log(`issue #${number} tracks the post-publish smoke failure of @flisk-sh/flisk@${version}`);
	return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
