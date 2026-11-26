// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for the ADOPTER-COVERAGE.md version/PR check in check-adopter-coverage.mjs. Run by
// `make test-shell` (npm run test:scripts). A small fixture plus fake git/npm deps stands in for a
// repository, tags and the registry, so the test needs no network.
import assert from "node:assert/strict";
import test from "node:test";
import {
	checkPair,
	mergeCommitsByPr,
	parsePairs,
} from "./check-adopter-coverage.mjs";

const FEATURES_TABLE = [
	"| Compose | service.json | Since (core release) | Importer and exporter | Needed by | Status |",
	"|---|---|---|---|---|---|",
	"| `healthcheck` command | `healthCheck` | 1.4.0 (`healthCheck`) | yes | nosia | covered |",
	"| `models` | `models` | 1.4.27 | yes | nosia | tested |",
	"| `include:` | resolved by the importer | n/a (importer) | yes | wger | tested |",
].join("\n");

const SURPRISES_TABLE = [
	"| What happened | Issue | State |",
	"|---|---|---|",
	"| injected DATABASE_URL | #2991 | fixed in 1.4.30 (#3010) |",
	"| memory limit | #2992 | fixed in 1.4.29 (#3001) |",
	"| two PRs, a version in a note | #2963 | fixed in 1.4.31 (#3025, #3034; the npm 1.4.30 package was built before #3025) |",
	"| not yet released | #9999 | fixed in 1.9.99 (#9998) |",
].join("\n");

const LOG = [
	"aaa111\tdocs: adopter coverage rows",
	"bbb222\tfix(engine): inject DATABASE_URL only when asked (#3010)",
	"ccc333\tfix(engine): raise the memory floor (#3001)",
	"ddd444\tfix(up): start a BYO-only project without the router (#3025)",
	"eee555\tfix(up): keep Postgres opt-in for BYO-only projects (#3034)",
].join("\n");

const deps = (overrides = {}) => ({
	mergeCommit: (pr) =>
		({ 3010: "bbb222", 3001: "ccc333", 3025: "ddd444", 3034: "eee555" })[pr] ?? null,
	tagsContaining: (sha) =>
		({
			bbb222: ["v1.4.30", "v1.4.31"],
			ccc333: ["v1.4.29", "v1.4.30", "v1.4.31"],
			ddd444: ["v1.4.31"],
			eee555: ["v1.4.31"],
		})[sha] ?? [],
	npmVersions: new Set(["1.4.29", "1.4.30", "1.4.31"]),
	...overrides,
});

test("parsePairs reads fixed-in clauses and keeps note versions out of the claim", () => {
	const pairs = parsePairs(SURPRISES_TABLE);
	assert.equal(pairs.length, 4);
	assert.deepEqual(pairs[2], {
		version: "1.4.31",
		prs: [3025, 3034],
		row: "| two PRs, a version in a note | #2963 | fixed in 1.4.31 (#3025, #3034; the npm 1.4.30 package was built before #3025) |",
	});
});

test("parsePairs skips feature rows: a Since version with no PR is not checkable", () => {
	assert.deepEqual(parsePairs(FEATURES_TABLE), []);
});

test("parsePairs pairs a lone Since version with PR refs in the same row", () => {
	const table = [
		"| Compose | service.json | Since (core release) | Importer and exporter | Needed by | Status |",
		"|---|---|---|---|---|---|",
		"| `widgets` | `widgets` | 1.4.30 | yes | acme (#1234) | covered |",
	].join("\n");
	assert.deepEqual(parsePairs(table), [
		{
			version: "1.4.30",
			prs: [1234],
			row: "| `widgets` | `widgets` | 1.4.30 | yes | acme (#1234) | covered |",
		},
	]);
});

test("mergeCommitsByPr takes the trailing (#NNNN) subject marker only", () => {
	const byPr = mergeCommitsByPr(LOG);
	assert.equal(byPr.get(3010), "bbb222");
	assert.equal(byPr.get(3034), "eee555");
	assert.equal(byPr.get(42), undefined);
});

test("a correct pair passes", () => {
	const [pair] = parsePairs(SURPRISES_TABLE);
	assert.equal(checkPair(pair, 3010, deps()), null);
});

test("a version the tag does not contain fails with the first tag that does", () => {
	const wrong = "| x | #1 | fixed in 1.4.29 (#3010) |";
	const [pair] = parsePairs(wrong);
	const failure = checkPair(pair, 3010, deps());
	assert.match(failure, /claims 1\.4\.29 for #3010/);
	assert.match(failure, /first tag that does: v1\.4\.30/);
});

test("a version missing from npm fails even when the tag holds the commit", () => {
	const [pair] = parsePairs("| x | #1 | fixed in 1.4.31 (#3025) |");
	const failure = checkPair(pair, 3025, deps());
	assert.equal(failure, null); // tag and npm both hold it here
	const [pair2] = parsePairs("| x | #1 | fixed in 1.4.33 (#3025) |");
	// 1.4.33 contains the commit (tags list v1.4.31 only, so this fails on the tag first).
	assert.match(checkPair(pair2, 3025, deps()), /first tag that does: v1\.4\.31/);
});

test("npm absence is reported for a covered commit whose version is unpublished", () => {
	const [pair] = parsePairs("| x | #1 | fixed in 1.4.30 (#3010) |");
	const noNpm = deps({ npmVersions: new Set(["1.4.29", "1.4.31"]) });
	assert.match(checkPair(pair, 3010, noNpm), /npm has no @flisk-sh\/flisk@1\.4\.30/);
});

test("a PR whose merge commit is missing fails with the fetch-depth hint", () => {
	const [pair] = parsePairs("| x | #1 | fixed in 1.4.30 (#9998) |");
	assert.match(checkPair(pair, 9998, deps()), /fetch-depth: 0/);
});
