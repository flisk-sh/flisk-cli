// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Ejects a merge queue head that is stuck so the entries behind it stop waiting (#5044). On 2026-11-21 a single stale
// pull request held 80 PRs at the head of the main merge queue for 4.5 hours: the queue built one entry at a time,
// every merge to main rebuilt its batch from zero, and nothing noticed that the head was going nowhere.
//   node scripts/merge-queue-watchdog.mjs --repo <owner/name> [--wait-minutes <n>] [--max-failed-batches <n>] [--dry-run]
//
// The head entry (lowest position) is stuck when, since it became the head (see headSince):
//   - its batches failed --max-failed-batches times (default 2): merge_group runs concluded failure or timed_out on
//     that many distinct gh-readonly-queue/<branch>/pr-<number>-* refs. A cancelled run does not count: GitHub cancels
//     a batch's remaining runs when the batch dies, and those say nothing about the pull request.
//   - or it has held the head for over --wait-minutes (default 60), measured from the first batch that built for it
//     once it was the head. The queue builds several entries at once (max_entries_to_build), so an entry can have
//     batches from before it reached the head; those say nothing about how long it has held the head.
// A head that never got a batch is the stalled-queue case (#5105), left for the stalled-merge-queue workflow; an entry
// GitHub already judges (MERGEABLE, UNMERGEABLE) is left alone.
// Dequeue uses the same dequeuePullRequest mutation as the stalled-queue bot, including its quirk: the mutation can
// report "Failed to remove PR from the merge queue" after removing it, so the queue is read again and the PR's absence
// is what counts. Reads the token from GH_TOKEN and shells out to `gh`.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const WAIT_MS = 60 * 60 * 1000;
export const MAX_FAILED_BATCHES = 2;
export const FAILED = ["failure", "timed_out"];
export const QUEUE_PREFIX = "gh-readonly-queue/";
export const MARKER = "<!-- merge-queue-watchdog -->";

// The merge_group runs that belong to one queue entry: runs on its gh-readonly-queue/<branch>/pr-<number>-* refs,
// created since enqueuedMs, so runs of an earlier queue stay of the same pull request do not count.
export function prQueueRuns(runs, branch, prNumber, enqueuedMs) {
	const prefix = `${QUEUE_PREFIX}${branch}/pr-${prNumber}-`;
	return (runs ?? []).filter(
		(run) =>
			run.event === "merge_group" &&
			typeof run.head_branch === "string" &&
			run.head_branch.startsWith(prefix) &&
			Date.parse(run.created_at) >= enqueuedMs,
	);
}

// When the head became the head. Entries ahead of it leave the queue by merging, and a pull request that is no longer
// queued but has a successful batch run merged (or was about to) when that run finished, so the latest such finish marks
// the handover; with none, the head has been there since it enqueued. Batches that built for the head before then were
// speculative (they carried the entries ahead of it) and are not its own.
export function headSince({ head, entries, runs, branch = "main" }) {
	let since = Date.parse(head.enqueuedAt);
	const queued = new Set(entries.map((entry) => entry.pullRequest?.number));
	const prefix = `${QUEUE_PREFIX}${branch}/pr-`;
	for (const run of runs ?? []) {
		if (run.event !== "merge_group" || run.conclusion !== "success") continue;
		if (typeof run.head_branch !== "string" || !run.head_branch.startsWith(prefix)) continue;
		const number = Number(/^(\d+)-/.exec(run.head_branch.slice(prefix.length))?.[1]);
		if (!Number.isFinite(number) || queued.has(number)) continue;
		const finished = Date.parse(run.updated_at ?? run.created_at);
		if (Number.isFinite(finished)) since = Math.max(since, finished);
	}
	return since;
}

// The newest run first, so [0] is the run to link when one batch failed after another.
const newestFirst = (runs) => [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

// The stuck head entry, or null when the queue is healthy or the head is somebody else's problem. Pure: entries and
// runs are plain objects as read from the API, now is epoch millis.
export function stuckHead({ entries, runs, now, waitMs = WAIT_MS, maxFailedBatches = MAX_FAILED_BATCHES, branch = "main" }) {
	if (!entries || entries.length === 0) return null;
	const head = entries.reduce((a, entry) => (entry.position < a.position ? entry : a));
	const pr = head.pullRequest;
	if (!pr || pr.state !== "OPEN") return null;
	if (head.state !== "AWAITING_CHECKS" && head.state !== "QUEUED") return null;
	const prRuns = prQueueRuns(runs, branch, pr.number, headSince({ head, entries, runs, branch }));
	// A head with no batch since it took the head never started: the stalled queue, not a stuck one.
	if (prRuns.length === 0) return null;
	const failedRuns = prRuns.filter((run) => FAILED.includes(run.conclusion));
	const failedBatches = new Set(failedRuns.map((run) => run.head_branch)).size;
	const ordered = newestFirst(prRuns);
	if (failedBatches >= maxFailedBatches) {
		return { head, reason: "failed-batches", failedBatches, waitMs, run: newestFirst(failedRuns)[0] };
	}
	const firstRunMs = Math.min(...prRuns.map((run) => Date.parse(run.created_at)));
	if (now - firstRunMs > waitMs) {
		// `failed` says whether the linked run is a failure: a timeout with only cancelled or running batches has none.
		const failed = newestFirst(failedRuns)[0];
		return { head, reason: "waiting", failedBatches, waitMs, run: failed ?? ordered[0], runFailed: failed !== undefined, firstRunMs };
	}
	return null;
}

// Whether prNumber was in the queue before and is gone after: the dequeue worked, whatever the mutation said.
export function confirmDequeued(beforeEntries, afterEntries, prNumber) {
	const was = beforeEntries.some((entry) => entry.pullRequest?.number === prNumber);
	const is = afterEntries.some((entry) => entry.pullRequest?.number === prNumber);
	return was && !is;
}

// Reads the flags: --repo (default $GITHUB_REPOSITORY), --wait-minutes (default 60), --max-failed-batches
// (default 2), --dry-run. Returns null when a value is missing or malformed.
export function parseArgs(argv, env = {}) {
	const value = (flag) => {
		const at = argv.indexOf(flag);
		return at >= 0 ? argv[at + 1] : undefined;
	};
	const repo = value("--repo") ?? env.GITHUB_REPOSITORY;
	if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
	for (const flag of ["--wait-minutes", "--max-failed-batches"]) {
		if (argv.includes(flag) && !/^\d+$/.test(value(flag) ?? "")) return null;
	}
	return {
		repo,
		waitMs: argv.includes("--wait-minutes") ? Number(value("--wait-minutes")) * 60 * 1000 : WAIT_MS,
		maxFailedBatches: argv.includes("--max-failed-batches") ? Number(value("--max-failed-batches")) : MAX_FAILED_BATCHES,
		dryRun: argv.includes("--dry-run"),
	};
}

export function ejectComment({ stuck, behindBy }) {
	const runUrl = stuck.run?.html_url;
	const runLine = runUrl ? ` Latest batch run: ${runUrl}` : "";
	const why =
		stuck.reason === "failed-batches"
			? `its batches failed ${stuck.failedBatches} times.${runLine}`
			: `it held the head of the queue for over ${Math.round(stuck.waitMs / 60000)} minutes without a batch finishing.${runLine}`;
	const stale =
		behindBy > 0
			? ` Its branch is ${behindBy} commit(s) behind \`main\`; update the branch before re-queueing so the next batch tests current main.`
			: "";
	// A timeout with no failed run (cancelled or still-running batches) has no failing check to point at.
	const next =
		stuck.reason === "waiting" && stuck.runFailed === false
			? `No check failed: its batches did not finish in time. Look at the linked run, update the branch from \`main\` if it is behind, then enable auto-merge again; once the checks pass, the pull request rejoins the queue on its own.`
			: `Fix the failing check, then enable auto-merge again; once the checks pass, the pull request rejoins the queue on its own.`;
	return [
		MARKER,
		`I removed this pull request from the merge queue: ${why} While it held the head, every PR behind it waited (https://github.com/flisk-sh/flisk/issues/5044).${stale}`,
		``,
		next,
		``,
		`_Posted by the merge-queue-watchdog workflow._`,
	].join("\n");
}

// The gh CLI is preinstalled on the GitHub Actions runner this workflow runs on, at a fixed, root-owned path;
// a PATH lookup is how a workflow step reaches it, so the S4036 PATH-search warning is suppressed here.
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); // NOSONAR

// dequeuePullRequest can report "Failed to remove PR from the merge queue" after removing the PR, so that error is
// not treated as a failure here; the caller re-reads the queue and confirms with confirmDequeued.
export const DEQUEUE_MUTATION = "mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}";
export const QUEUE_QUERY =
	"query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){entries(first:100){nodes{position state enqueuedAt headCommit{oid} pullRequest{number id mergeable state headRefOid}}}}}}";

export function dequeuePullRequest(repo, prId, run = gh) {
	try {
		run(["api", "graphql", "-f", `query=${DEQUEUE_MUTATION}`, "-F", `id=${prId}`]);
		return "dequeued";
	} catch (err) {
		if (/Failed to remove PR from the merge queue/.test(`${err.stderr ?? ""}${err.message ?? ""}`)) return "maybe-dequeued";
		throw err;
	}
}

// The queue's entries, [] when the branch has no merge queue.
export function listQueue(repo, branch, run = gh) {
	const [owner, name] = repo.split("/");
	const out = run(["api", "graphql", "-f", `query=${QUEUE_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `branch=${branch}`, "--jq", ".data.repository.mergeQueue.entries.nodes // []"]);
	return JSON.parse(out);
}

function defaultBranch(repo) {
	const out = gh(["api", `repos/${repo}`, "--jq", ".default_branch"]);
	return out.trim();
}

// Every merge_group run since sinceDay (YYYY-MM-DD), so a head that enqueued days ago still finds its batches.
export function listMergeGroupRuns(repo, sinceDay, run = gh) {
	const out = run(["api", "--paginate", "-X", "GET", `repos/${repo}/actions/runs`, "-f", "event=merge_group", "-f", "per_page=100", "-f", `created=>=${sinceDay}`, "--jq", ".workflow_runs[] | {id, name, status, conclusion, event, head_branch, created_at, updated_at, html_url}"]);
	const runs = [];
	for (const line of out.split("\n")) if (line.trim()) runs.push(JSON.parse(line));
	return runs;
}

// How far the head branch is behind the base, for the comment's "update first" hint. Advisory only: a failed compare
// returns null and the line is left out.
export function behindBy(repo, base, headOid, run = gh) {
	try {
		const out = run(["api", `repos/${repo}/compare/${base}...${headOid}`, "--jq", ".behind_by"]);
		const n = Number(out.trim());
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
}

function commentOnPr(repo, prNumber, body) {
	gh(["pr", "comment", String(prNumber), "--repo", repo, "--body", body]);
}

// Dequeues the stuck head and comments on its pull request. run, readQueue, comment and behind are injectable for
// tests; dryRun only logs. beforeEntries is the queue snapshot taken before the dequeue, so the spurious
// dequeuePullRequest error can be distinguished from a real failure by re-reading the queue afterwards.
export function ejectHead({ repo, branch, beforeEntries, stuck, dryRun = false, run = gh, readQueue = listQueue, comment = commentOnPr, behind = behindBy }) {
	const pr = stuck.head.pullRequest;
	const lines = [];
	const staleBy = dryRun ? null : behind(repo, branch, pr.headRefOid, run);
	lines.push(`${dryRun ? "would dequeue" : dequeuePullRequest(repo, pr.id, run)} #${pr.number} (${stuck.reason})`);
	if (!dryRun) {
		const after = readQueue(repo, branch);
		if (!confirmDequeued(beforeEntries, after, pr.number)) throw new Error(`dequeue of #${pr.number} could not be confirmed in the queue`);
		lines.push(`confirmed: #${pr.number} is out of the queue`);
		const body = ejectComment({ stuck, behindBy: staleBy });
		lines.push(`commenting on #${pr.number}`);
		comment(repo, pr.number, body);
	}
	return lines;
}

// The day before the oldest entry enqueued, so listMergeGroupRuns pages a bounded window and still covers it.
export function runsSince(entries, now = Date.now()) {
	const oldest = Math.min(...entries.map((entry) => Date.parse(entry.enqueuedAt)));
	return new Date(Math.min(oldest, now) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function main(argv) {
	const args = parseArgs(argv, process.env);
	if (!args) {
		console.error("usage: merge-queue-watchdog.mjs --repo <owner/name> [--wait-minutes <n>] [--max-failed-batches <n>] [--dry-run]");
		return 2;
	}
	const { repo, waitMs, maxFailedBatches, dryRun } = args;
	const branch = defaultBranch(repo);
	const entries = listQueue(repo, branch);
	if (entries.length === 0) {
		console.log(`merge queue on ${branch}: empty`);
		return 0;
	}
	const runs = listMergeGroupRuns(repo, runsSince(entries));
	const stuck = stuckHead({ entries, runs, now: Date.now(), waitMs, maxFailedBatches, branch });
	if (!stuck) {
		console.log(`merge queue on ${branch}: ${entries.length} entries, head not stuck`);
		return 0;
	}
	console.log(`merge queue on ${branch}: #${stuck.head.pullRequest.number} stuck at position ${stuck.head.position} (${stuck.reason}, ${stuck.failedBatches} failed batch(es))`);
	for (const line of ejectHead({ repo, branch, beforeEntries: entries, stuck, dryRun })) console.log(line);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
