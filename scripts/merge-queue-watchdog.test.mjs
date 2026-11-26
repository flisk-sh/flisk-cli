// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for merge-queue-watchdog: when the head entry counts as stuck, with runs injected.
import assert from "node:assert/strict";
import test from "node:test";
import {
	confirmDequeued,
	dequeuePullRequest,
	ejectComment,
	ejectHead,
	parseArgs,
	prQueueRuns,
	runsSince,
	stuckHead,
} from "./merge-queue-watchdog.mjs";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const entry = (position, prNumber, over = {}) => ({
	position,
	state: "AWAITING_CHECKS",
	enqueuedAt: "2026-11-22T08:00:00Z",
	headCommit: { oid: "abc" },
	pullRequest: { number: prNumber, id: `PR_${prNumber}`, mergeable: "MERGEABLE", state: "OPEN", headRefOid: `sha${prNumber}` },
	...over,
});

const run = (prNumber, over = {}) => ({
	id: 1,
	name: "🔀 PR | CI | Checks",
	event: "merge_group",
	status: "completed",
	conclusion: "failure",
	head_branch: `gh-readonly-queue/main/pr-${prNumber}-aaa`,
	created_at: "2026-11-22T09:00:00Z",
	html_url: `https://example.test/runs/${prNumber}`,
	...over,
});

test("prQueueRuns keeps only this entry's merge_group runs since enqueuedAt", () => {
	const enqueued = Date.parse("2026-11-22T08:00:00Z");
	const runs = [
		run(12),
		run(12, { event: "pull_request" }),
		run(12, { head_branch: "feature/x" }),
		run(123), // pr-12- does not match pr-123-
		run(12, { head_branch: "gh-readonly-queue/main/pr-12-bbb" }),
		run(12, { created_at: "2026-11-21T09:00:00Z" }), // before this queue stay: an earlier enqueue's batch
	];
	const kept = prQueueRuns(runs, "main", 12, enqueued);
	assert.deepEqual(
		kept.map((r) => r.head_branch),
		["gh-readonly-queue/main/pr-12-aaa", "gh-readonly-queue/main/pr-12-bbb"],
	);
});

test("an empty queue or a head GitHub already judges is not stuck", () => {
	assert.equal(stuckHead({ entries: [], runs: [run(1)], now: NOW }), null);
	assert.equal(
		stuckHead({ entries: [entry(1, 9, { state: "MERGEABLE" })], runs: [run(9), run(9, { head_branch: "gh-readonly-queue/main/pr-9-bbb" })], now: NOW }),
		null,
	);
	assert.equal(
		stuckHead({ entries: [entry(1, 9, { pullRequest: { state: "CLOSED" } })], runs: [run(9)], now: NOW }),
		null,
	);
});

test("a head with no batch since it enqueued is the stalled-queue case, not this one's", () => {
	const entries = [entry(1, 9, { state: "QUEUED", headCommit: null })];
	assert.equal(stuckHead({ entries, runs: [], now: NOW }), null);
	// another PR's runs do not count as the head's batch
	assert.equal(stuckHead({ entries, runs: [run(10)], now: NOW }), null);
});

test("two failed batches eject the head; one does not", () => {
	const entries = [entry(1, 9)];
	const one = [run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", created_at: "2026-11-22T11:45:00Z" })];
	assert.equal(stuckHead({ entries, runs: one, now: NOW }), null);
	const two = [...one, run(9, { head_branch: "gh-readonly-queue/main/pr-9-bbb", created_at: "2026-11-22T11:50:00Z" })];
	const stuck = stuckHead({ entries, runs: two, now: NOW });
	assert.equal(stuck.reason, "failed-batches");
	assert.equal(stuck.failedBatches, 2);
	assert.equal(stuck.run.html_url, "https://example.test/runs/9");
});

test("two failed runs in one batch count once, and cancelled or successful runs never count", () => {
	const entries = [entry(1, 9)];
	const runs = [
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", name: "CI | Checks" }),
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", name: "Resource types", conclusion: "timed_out" }),
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", conclusion: "cancelled" }),
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", conclusion: "success" }),
	];
	assert.equal(stuckHead({ entries, runs, now: NOW }).reason, "waiting");
	const second = [...runs, run(9, { head_branch: "gh-readonly-queue/main/pr-9-bbb" })];
	assert.equal(stuckHead({ entries, runs: second, now: NOW }).reason, "failed-batches");
});

test("a head holding the queue for over the wait limit is stuck even with no failed batch", () => {
	const entries = [entry(1, 9)];
	const building = [run(9, { conclusion: null, status: "in_progress", created_at: "2026-11-22T11:30:00Z" })];
	assert.equal(stuckHead({ entries, runs: building, now: NOW }), null); // 4 h enqueued but its only batch is 30 min old
	const churned = [
		run(9, { conclusion: "cancelled", created_at: "2026-11-22T08:05:00Z" }),
		run(9, { conclusion: null, status: "in_progress", head_branch: "gh-readonly-queue/main/pr-9-ccc", created_at: "2026-11-22T11:30:00Z" }),
	];
	const stuck = stuckHead({ entries, runs: churned, now: NOW });
	assert.equal(stuck.reason, "waiting");
});

test("a failed batch from before this queue stay does not count after a re-enqueue", () => {
	const entries = [entry(1, 9, { enqueuedAt: "2026-11-22T11:00:00Z" })];
	const runs = [
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", created_at: "2026-11-22T09:00:00Z" }),
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-bbb", created_at: "2026-11-22T10:00:00Z" }),
	];
	assert.equal(stuckHead({ entries, runs, now: NOW, waitMs: 4 * HOUR }), null);
});

test("only the head is judged: a non-head entry's failures never eject it", () => {
	const entries = [entry(1, 9), entry(2, 10)];
	const runs = [
		run(10, { head_branch: "gh-readonly-queue/main/pr-10-aaa" }),
		run(10, { head_branch: "gh-readonly-queue/main/pr-10-bbb" }),
		run(9, { conclusion: null, status: "in_progress", created_at: "2026-11-22T11:45:00Z" }),
	];
	assert.equal(stuckHead({ entries, runs, now: NOW }), null);
});

test("the wait limit and the failure limit are configurable", () => {
	const entries = [entry(1, 9)];
	const runs = [run(9, { conclusion: null, status: "in_progress", created_at: "2026-11-22T10:30:00Z" })];
	assert.equal(stuckHead({ entries, runs, now: NOW, waitMs: 2 * HOUR }), null);
	assert.equal(stuckHead({ entries, runs, now: NOW, waitMs: HOUR })?.reason, "waiting");
	const failed = [run(9)];
	assert.equal(stuckHead({ entries, runs: failed, now: NOW, maxFailedBatches: 1 })?.reason, "failed-batches");
});

test("confirmDequeued only trusts a PR that was queued and is gone", () => {
	const before = [entry(1, 9), entry(2, 10)];
	assert.equal(confirmDequeued(before, [entry(2, 10, { position: 1 })], 9), true);
	assert.equal(confirmDequeued(before, before, 9), false);
	assert.equal(confirmDequeued(before, [], 7), false); // never queued: nothing to confirm
});

test("parseArgs defaults, flags and malformed input", () => {
	assert.deepEqual(parseArgs(["--repo", "o/r"]), {
		repo: "o/r",
		waitMs: HOUR,
		maxFailedBatches: 2,
		dryRun: false,
	});
	const parsed = parseArgs(["--repo", "o/r", "--wait-minutes", "45", "--max-failed-batches", "3", "--dry-run"]);
	assert.equal(parsed.waitMs, 45 * 60 * 1000);
	assert.equal(parsed.maxFailedBatches, 3);
	assert.equal(parsed.dryRun, true);
	assert.equal(parseArgs([], { GITHUB_REPOSITORY: "o/r" }).repo, "o/r");
	assert.equal(parseArgs(["--repo", "not a repo"]), null);
	assert.equal(parseArgs(["--repo", "o/r", "--wait-minutes", "soon"]), null);
	assert.equal(parseArgs(["--repo", "o/r", "--max-failed-batches"]), null);
	assert.equal(parseArgs([]), null);
});

test("ejectComment links the failing run, cites the wait, and mentions a stale branch only when behind", () => {
	const stuck = {
		reason: "failed-batches",
		failedBatches: 2,
		run: { html_url: "https://example.test/runs/1" },
		head: entry(1, 9),
	};
	const body = ejectComment({ stuck, behindBy: 37 });
	assert.match(body, /failed 2 times/);
	assert.match(body, /https:\/\/example\.test\/runs\/1/);
	assert.match(body, /37 commit\(s\) behind `main`/);
	assert.match(body, /issues\/5044/);
	assert.match(body, /^<!-- merge-queue-watchdog -->/);
	const quiet = ejectComment({ stuck, behindBy: 0 });
	assert.doesNotMatch(quiet, /behind `main`/);
	const waiting = ejectComment({ stuck: { ...stuck, reason: "waiting", waitMs: HOUR, run: null }, behindBy: null });
	assert.match(waiting, /over 60 minutes/);
	assert.doesNotMatch(waiting, /Latest batch run/);
});

test("dequeuePullRequest treats the after-the-fact removal error as success and rethrows others", () => {
	assert.equal(dequeuePullRequest("o/r", "PR_1", () => {}), "dequeued");
	const flaky = Object.assign(new Error("failed"), { stderr: "GraphQL: Failed to remove PR from the merge queue" });
	assert.equal(dequeuePullRequest("o/r", "PR_1", () => { throw flaky; }), "maybe-dequeued");
	assert.throws(() => dequeuePullRequest("o/r", "PR_1", () => { throw new Error("HTTP 500"); }), /HTTP 500/);
});

test("ejectHead dequeues, confirms by re-reading the queue, then comments", () => {
	const calls = [];
	const stuck = { head: entry(1, 9), reason: "failed-batches", failedBatches: 2, waitMs: HOUR, run: { html_url: "u" } };
	const lines = ejectHead({
		repo: "o/r",
		branch: "main",
		beforeEntries: [entry(1, 9)],
		stuck,
		run: () => calls.push("api"),
		readQueue: () => [],
		comment: (repo, n, body) => calls.push(`comment ${n} ${body.length > 0}`),
		behind: () => 5,
	});
	assert.deepEqual(calls, ["api", "comment 9 true"]);
	assert.match(lines.join("\n"), /dequeued #9/);
	assert.match(lines.join("\n"), /confirmed: #9 is out of the queue/);
});

test("ejectHead throws when the PR is still queued, and never comments", () => {
	let commented = false;
	const stuck = { head: entry(1, 9), reason: "waiting", failedBatches: 0, waitMs: HOUR };
	assert.throws(
		() =>
			ejectHead({
				repo: "o/r",
				branch: "main",
				beforeEntries: [entry(1, 9)],
				stuck,
				run: () => {},
				readQueue: () => [entry(1, 9)],
				comment: () => (commented = true),
				behind: () => null,
			}),
		/could not be confirmed/,
	);
	assert.equal(commented, false);
});

test("ejectHead --dry-run only logs, never mutates", () => {
	let touched = false;
	const stuck = { head: entry(1, 9), reason: "waiting", failedBatches: 0, waitMs: HOUR };
	const lines = ejectHead({
		repo: "o/r",
		branch: "main",
		beforeEntries: [entry(1, 9)],
		stuck,
		dryRun: true,
		run: () => (touched = true),
		readQueue: () => (touched = true),
		comment: () => (touched = true),
		behind: () => (touched = true),
	});
	assert.equal(touched, false);
	assert.match(lines.join("\n"), /would dequeue #9/);
});

test("runsSince covers the day before the oldest entry", () => {
	const entries = [entry(1, 9, { enqueuedAt: "2026-11-20T08:00:00Z" }), entry(2, 10)];
	assert.equal(runsSince(entries, NOW), "2026-11-19");
	assert.equal(runsSince([entry(1, 9, { enqueuedAt: "2026-11-22T11:00:00Z" })], NOW), "2026-11-21");
});

test("a head promoted after an old speculative batch is timed from when it became the head", () => {
	const entries = [entry(1, 9)];
	const speculative = run(9, { conclusion: "cancelled", head_branch: "gh-readonly-queue/main/pr-9-old", created_at: "2026-11-22T09:00:00Z" });
	const fresh = run(9, { conclusion: null, status: "in_progress", head_branch: "gh-readonly-queue/main/pr-9-new", created_at: "2026-11-22T11:35:00Z" });
	// Nothing marks a handover: the head has held the head since it enqueued, and its first batch is the 09:00 one.
	assert.equal(stuckHead({ entries, runs: [speculative, fresh], now: NOW })?.reason, "waiting");
	// PR 7 was ahead of it and merged at 11:30 (no longer queued): the head's own batches start then.
	const ahead = run(7, { conclusion: "success", head_branch: "gh-readonly-queue/main/pr-7-zzz", created_at: "2026-11-22T11:00:00Z", updated_at: "2026-11-22T11:30:00Z" });
	assert.equal(stuckHead({ entries, runs: [speculative, fresh, ahead], now: NOW }), null);
	// A successful run of an entry that is still queued marks no handover.
	const behind = run(10, { conclusion: "success", head_branch: "gh-readonly-queue/main/pr-10-zzz", updated_at: "2026-11-22T11:30:00Z" });
	assert.equal(stuckHead({ entries: [entry(1, 9), entry(2, 10)], runs: [speculative, fresh, behind], now: NOW })?.reason, "waiting");
});

test("failed speculative batches from before the head took over do not count against it", () => {
	const entries = [entry(1, 9)];
	const ahead = run(7, { conclusion: "success", head_branch: "gh-readonly-queue/main/pr-7-zzz", updated_at: "2026-11-22T11:00:00Z" });
	const carried = [
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-aaa", created_at: "2026-11-22T10:00:00Z" }),
		run(9, { head_branch: "gh-readonly-queue/main/pr-9-bbb", created_at: "2026-11-22T10:30:00Z" }),
	];
	assert.equal(stuckHead({ entries, runs: [ahead, ...carried], now: NOW }), null);
});

test("the removal comment only asks to fix a failing check when one failed", () => {
	const head = entry(1, 9);
	const failing = ejectComment({ stuck: { head, reason: "failed-batches", failedBatches: 2, waitMs: HOUR, run: run(9), runFailed: true }, behindBy: 0 });
	assert.match(failing, /Fix the failing check/);
	const timedOut = ejectComment({
		stuck: { head, reason: "waiting", failedBatches: 0, waitMs: HOUR, run: run(9, { conclusion: "cancelled" }), runFailed: false },
		behindBy: 0,
	});
	assert.match(timedOut, /No check failed/);
	assert.doesNotMatch(timedOut, /Fix the failing check/);
});
