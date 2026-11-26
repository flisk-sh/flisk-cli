// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";

import {
	checksumNotes,
	groupPulls,
	parsePulls,
	previousTag,
	pullType,
	releaseBody,
	run,
} from "./release-notes.mjs";

// Modeled on the real merged pull requests between v1.4.29 and v1.4.30 (git log v1.4.29..v1.4.30):
// 24 squash-merged pulls across feat, fix, test, docs, ci, refactor and chore types.
const GENERATED_BODY_1_4_30 = `## What's Changed
* Release 1.4.30 (automatic version bump) (#3023) by @app/flisk-release-bot in https://github.com/flisk-sh/flisk-cli/pull/3023
* docs(readme): match translated quickstart and show demo result (#3029) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3029
* fix(cli): read FLISK_HTTP_PORT, FLISK_HTTPS_PORT and FLISK_POSTGRES_PORT from the project .env (#2971) (#3028) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3028
* test(e2e): swarm chaos case S3 retries when the kill misses the claim (#3027) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3027
* feat(cli): start the router and the shared Postgres only when a resource uses them (#2963) (#3025) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3025
* fix(status): a native project's services answer on localhost, not a Traefik route (#3024) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3024
* test(e2e): agent starters through a real flisk up, with kill -9 chaos cases (#3022) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3022
* fix(templates): swarm recovers failed tasks; template tests ask the OS for ports (#3018) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3018
* feat(templates): security-agent starter, scanner, triage and reporter as local processes (#3016) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3016
* feat(templates): swarm starter, a coordinator and three pulling workers as local processes (#3015) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3015
* fix(doctor): align NATS project name fallback (#2960) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/2960
* ci: cancel the runs of merge queue batches that no longer exist (#3014) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3014
* feat(project): clone missing service repositories safely (#2910) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/2910
* test(e2e): cover diffing a PR against its merge commit's parent (#3013) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3013
* ci(e2e): diff a PR against its merge commit's parent so unrelated legs stay skipped (#3012) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3012
* feat(engine): pass migrator outputs to dependent services (#2919) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/2919
* refactor(cli): centralize Compose project naming (#2961) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/2961
* chore(scores): raise the install-weight baseline to the current main size (#3011) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/3011
* fix(engine): a databaseName discovery computed is not a request for the shared Postgres (#3010) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/3010
* feat(cli): add repository-pinned version evaluator (#2951) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/2951
* fix(discovery): resolve no-op cache persistence callback (#2958) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/2958
* test(chaos): validate generated Compose and Dockerfiles without a Docker daemon (#2954) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/2954
* docs(docker): explain L1-L4 golden image build failures (#2953) by @octocat in https://github.com/flisk-sh/flisk-cli/pull/2953
* feat(doctor): identify busy port owners and configuration (#2952) by @draarivpatel-ui in https://github.com/flisk-sh/flisk-cli/pull/2952

## New Contributors
* @octocat made their first contribution in https://github.com/flisk-sh/flisk-cli/pull/2952

**Full Changelog**: https://github.com/flisk-sh/flisk-cli/compare/v1.4.29...v1.4.30
`;

test("checksumNotes keeps the cosign verify line byte-for-byte", () => {
	const notes = checksumNotes("1.4.30");
	assert.match(notes, /^Signed checksums for flisk 1\.4\.30\./);
	assert.match(
		notes,
		/cosign verify-blob --bundle checksums\.txt\.sigstore\.json --certificate-identity-regexp 'https:\/\/github\.com\/flisk-sh\/flisk\/\.github\/workflows\/\(release-binaries\|sign-release\)\\\.yml@\.\*' --certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com checksums\.txt$/,
	);
});

test("previousTag returns the highest vX.Y.Z tag below the version", () => {
	const tags = ["v1.4.28", "v1.4.29", "v1.4.30", "v1.4.31", "rc-1.4.32", "main", "v1.3.207"];
	assert.equal(previousTag(tags, "1.4.30"), "v1.4.29");
	// The tag of the release itself is skipped even when listed (a re-run).
	assert.equal(previousTag(["v1.4.30", "v1.4.29"], "1.4.30"), "v1.4.29");
	// No lower tag: the first release.
	assert.equal(previousTag(["v9.9.9"], "1.0.0"), null);
	assert.equal(previousTag([], "1.4.30"), null);
});

test("parsePulls reads title, author and link from What's Changed only", () => {
	const pulls = parsePulls(GENERATED_BODY_1_4_30);
	assert.equal(pulls.length, 24);
	assert.deepEqual(pulls[1], {
		title: "docs(readme): match translated quickstart and show demo result (#3029)",
		login: "draarivpatel-ui",
		url: "https://github.com/flisk-sh/flisk-cli/pull/3029",
	});
	// New Contributors entries are not pull titles.
	assert.ok(!pulls.some((p) => p.title.includes("made their first contribution")));
	// A bullet without an author still lands, with no login.
	const bare = parsePulls("## What's Changed\n* some change in https://github.com/o/r/pull/1\n");
	assert.deepEqual(bare, [{ title: "some change", login: null, url: "https://github.com/o/r/pull/1" }]);
	assert.equal(parsePulls("").length, 0);
	assert.equal(parsePulls("**Full Changelog**: https://github.com/o/r/compare/a...b\n").length, 0);
});

test("pullType reads the conventional-commit type", () => {
	assert.equal(pullType("feat(cli): add repository-pinned version evaluator (#2951)"), "feat");
	assert.equal(pullType("fix(templates): swarm recovers failed tasks (#3018)"), "fix");
	assert.equal(pullType("ci(e2e): diff a PR against its merge commit's parent (#3012)"), "ci");
	assert.equal(pullType("ci: cancel the runs of merge queue batches (#3014)"), "ci");
	assert.equal(pullType("feat(engine)!: pass migrator outputs (#2919)"), "feat");
	assert.equal(pullType("Release 1.4.30 (automatic version bump) (#3023)"), "other");
});

test("groupPulls orders sections and buckets every pull", () => {
	const groups = groupPulls(parsePulls(GENERATED_BODY_1_4_30));
	const headings = groups.map((g) => g.heading);
	assert.deepEqual(headings, [
		"Features",
		"Bug Fixes",
		"Documentation",
		"Tests",
		"CI and Build",
		"Refactoring",
		"Chores",
		"Other Changes",
	]);
	assert.equal(groups.find((g) => g.heading === "Features").pulls.length, 7);
	assert.equal(groups.find((g) => g.heading === "Bug Fixes").pulls.length, 6);
	assert.equal(groups.find((g) => g.heading === "Other Changes").pulls.length, 1);
	assert.equal(
		groups.find((g) => g.heading === "Other Changes").pulls[0].title,
		"Release 1.4.30 (automatic version bump) (#3023)",
	);
	// A dependabot pull counts as Dependencies whatever its title says.
	const deps = groupPulls([
		{ title: "Bump bun from 1.4.3 to 1.4.4", login: "dependabot[bot]", url: "u" },
	]);
	assert.equal(deps[0].heading, "Dependencies");
});

test("releaseBody puts the cosign line first and the grouped pulls under it", () => {
	const body = releaseBody({
		version: "1.4.30",
		repo: "flisk-sh/flisk",
		previous: "v1.4.29",
		generatedBody: GENERATED_BODY_1_4_30,
	});
	const lines = body.split("\n");
	assert.ok(lines[0].startsWith("Signed checksums for flisk 1.4.30."));
	assert.ok(lines[0].includes("cosign verify-blob"));
	assert.match(body, /## What's Changed\n\n### Features/);
	assert.ok(body.indexOf("### Features") < body.indexOf("### Bug Fixes"));
	assert.ok(body.indexOf("### Bug Fixes") < body.indexOf("### Documentation"));
	assert.match(
		body,
		/\* feat\(templates\): swarm starter, a coordinator and three pulling workers as local processes \(#3015\) by @draarivpatel-ui in https:\/\/github\.com\/flisk-sh\/flisk\/pull\/3015/,
	);
	assert.ok(
		body.trimEnd().endsWith(
			"**Full Changelog**: https://github.com/flisk-sh/flisk-cli/compare/v1.4.29...v1.4.30",
		),
	);
	// No notes for the range: just the checksum paragraph, no empty heading.
	const empty = releaseBody({ version: "1.4.30", repo: "flisk-sh/flisk", previous: "v1.4.29", generatedBody: "" });
	assert.equal(empty, `${checksumNotes("1.4.30")}\n`);
});

function fakeFetch({ tags = [], notes = "", tagStatus = 200, notesStatus = 200 }) {
	return async (url, options = {}) => ({
		ok: (options.method === "POST" ? notesStatus : tagStatus) === 200,
		status: options.method === "POST" ? notesStatus : tagStatus,
		async json() {
			return options.method === "POST" ? { body: notes } : tags;
		},
	});
}

test("run writes the full body for the 1.4.29 to 1.4.30 range", async () => {
	const out = { text: "", write(t) { this.text += t; } };
	const warnings = [];
	await run({
		version: "1.4.30",
		repo: "flisk-sh/flisk",
		fetchImpl: fakeFetch({
			tags: [{ name: "v1.4.29" }, { name: "v1.4.30" }, { name: "v1.4.31" }],
			notes: GENERATED_BODY_1_4_30,
		}),
		log: (m) => warnings.push(m),
		out,
	});
	assert.deepEqual(warnings, []);
	const body = out.text;
	assert.ok(body.startsWith("Signed checksums for flisk 1.4.30."));
	assert.match(body, /### Features\n\n\* feat\(cli\): start the router/);
	assert.match(body, /\*\*Full Changelog\*\*: https:\/\/github\.com\/flisk-sh\/flisk\/compare\/v1\.4\.29\.\.\.v1\.4\.30/);
});

test("run still prints the checksum paragraph when the API refuses", async () => {
	const out = { text: "", write(t) { this.text += t; } };
	const warnings = [];
	await run({
		version: "1.4.30",
		repo: "flisk-sh/flisk",
		fetchImpl: fakeFetch({ tagStatus: 404, notesStatus: 404 }),
		log: (m) => warnings.push(m),
		out,
	});
	assert.equal(out.text, `${checksumNotes("1.4.30")}\n`);
	assert.equal(warnings.length, 2);
	assert.ok(warnings.every((m) => m.startsWith("::warning::")));
});
