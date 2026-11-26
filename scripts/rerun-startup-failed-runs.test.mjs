// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for rerun-startup-failed-runs: which runs get another attempt, with the clock, the bounds and the open
// pull requests injected.
import assert from "node:assert/strict";
import test from "node:test";
import { rerun, startupFailedRuns } from "./rerun-startup-failed-runs.mjs";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const run = (id, over = {}) => ({
	id,
	name: "CI Checks",
	event: "pull_request",
	conclusion: "startup_failure",
	run_attempt: 1,
	created_at: "2026-11-12T10:00:00Z",
	head_branch: "fix/thing",
	head_sha: "aaa",
	head_repo: "fork-owner/flisk",
	...over,
});
const pulls = [{ head_repo: "fork-owner/flisk", head_ref: "fix/thing", head_sha: "aaa" }];
const opts = { now: NOW, pulls };

test("a first-attempt startup_failure pull request run still at its PR head is picked", () => {
	assert.deepEqual(startupFailedRuns([run(1)], opts).map((r) => r.id), [1]);
});

test("a run already retried, too old, or ended another way is left alone", () => {
	const runs = [
		run(1, { run_attempt: 2 }),
		run(2, { created_at: "2026-11-10T11:59:59Z" }), // past the default 24h window
		run(3, { conclusion: "failure" }),
		run(4, { conclusion: null }),
		run(5, { run_attempt: 0 }),
	];
	assert.deepEqual(startupFailedRuns(runs, opts), []);
});

test("a pull request run is re-run only while its PR is open and still at that head", () => {
	const runs = [
		run(1, { head_sha: "old-sha" }), // superseded by a newer push
		run(2, { head_branch: "other-branch" }), // no open pull request matches
	];
	assert.deepEqual(startupFailedRuns(runs, opts), []);
	// Same branch name on a different fork must not match this pull request.
	assert.deepEqual(
		startupFailedRuns([run(3)], { now: NOW, pulls: [{ head_repo: "someone-else/flisk", head_ref: "fix/thing", head_sha: "aaa" }] }),
		[],
	);
});

test("merge_group runs are skipped; push and dispatch runs need no pull match", () => {
	const runs = [
		run(1, { event: "merge_group" }),
		run(2, { event: "push", head_branch: "main", head_repo: "flisk-sh/flisk" }),
		run(3, { event: "workflow_dispatch", head_branch: "main", head_repo: "flisk-sh/flisk" }),
	];
	assert.deepEqual(startupFailedRuns(runs, { now: NOW, pulls: [] }).map((r) => r.id), [2, 3]);
});

test("the oldest runs go first and the limit caps the sweep", () => {
	const runs = [
		run(1, { created_at: "2026-11-12T11:00:00Z" }),
		run(2, { created_at: "2026-11-12T09:00:00Z" }),
		run(3, { created_at: "2026-11-12T10:00:00Z" }),
	];
	assert.deepEqual(startupFailedRuns(runs, { ...opts, limit: 2 }).map((r) => r.id), [2, 3]);
});

test("rerun posts to the run's rerun endpoint", () => {
	const calls = [];
	assert.equal(rerun("o/r", 42, (args) => calls.push(args)), "rerun-requested");
	assert.deepEqual(calls, [["api", "-X", "POST", "repos/o/r/actions/runs/42/rerun"]]);
});
