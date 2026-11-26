// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Re-runs workflow runs that GitHub rejected before scheduling: conclusion "startup_failure", zero jobs, no log and
// no annotation. A pull request hit by one shows no checks at all and the contributor has nothing to fix or click
// (#3944: 22 runs inside 30 minutes on 2026-11-11, pull_request and workflow_dispatch alike). Re-running queues a
// fresh attempt; only first-attempt failures are picked, so a run GitHub keeps rejecting is retried once, not
// forever.
//
//   node scripts/rerun-startup-failed-runs.mjs --repo <owner/name> [--dry-run] [--max-age-hours 24] [--limit 20]
//
// A run counts when its conclusion is startup_failure, it is still on attempt 1, and it is younger than
// --max-age-hours. A pull_request run must also still be the head of an open pull request: re-running stale code or a
// closed pull request's checks helps nobody. merge_group runs are skipped: a dead batch's queue entry is already
// gone and re-entering the queue is what restores it. Oldest runs go first and --limit caps a sweep, so a
// GitHub-wide outage drains over several sweeps instead of thundering back at once. Reads the token from GH_TOKEN
// and shells out to `gh`.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_AGE_HOURS = 24;
export const DEFAULT_LIMIT = 20;

// The runs worth another attempt, oldest first and at most `limit`. pulls is the open pull requests as
// [{ head_repo, head_ref, head_sha }]: a pull_request run only counts when it is still the head of one of them.
export function startupFailedRuns(
	runs,
	{ now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, limit = DEFAULT_LIMIT, pulls = [] } = {},
) {
	const youngest = now - maxAgeHours * 3_600_000;
	const headOf = new Map(pulls.map((p) => [`${p.head_repo}#${p.head_ref}`, p.head_sha]));
	const current = (run) => {
		if (run.event === "merge_group") return false;
		if (!run.event?.startsWith("pull_request")) return true;
		return headOf.get(`${run.head_repo}#${run.head_branch}`) === run.head_sha;
	};
	return runs
		.filter(
			(run) =>
				run.conclusion === "startup_failure" &&
				(run.run_attempt ?? 1) === 1 &&
				Date.parse(run.created_at) >= youngest &&
				current(run),
		)
		.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
		.slice(0, limit);
}

// The `gh` on PATH is the intended binary here: the scheduled workflow runs the GitHub CLI the runner image
// provides, and a local run should use the caller's own install. Sonar javascript:S4036 (PATH lookup) is
// therefore suppressed on the call.
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); // NOSONAR

// Queue a fresh attempt of a run. A run re-run by someone else between listing and this call just gets one more
// attempt; the first-attempt filter is what keeps that rare.
export function rerun(repo, id, run = gh) {
	run(["api", "-X", "POST", `repos/${repo}/actions/runs/${id}/rerun`]);
	return "rerun-requested";
}

// The created bound is a UTC date, coarser than the precise timestamp filter in startupFailedRuns; it only exists to
// keep the listing from paginating through every startup_failure the repository ever recorded.
function listRuns(repo, sinceDate) {
	const out = gh([
		"api",
		"--paginate",
		`repos/${repo}/actions/runs?status=startup_failure&per_page=100&created=%3E${sinceDate}`,
		"--jq",
		".workflow_runs[] | {id, name, event, conclusion, run_attempt, created_at, head_branch, head_sha, head_repo: .head_repository.full_name}",
	]);
	return out
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

function listOpenPulls(repo) {
	const out = gh([
		"api",
		"--paginate",
		`repos/${repo}/pulls?state=open&per_page=100`,
		"--jq",
		".[] | {head_repo: .head.repo.full_name, head_ref: .head.ref, head_sha: .head.sha}",
	]);
	return out
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
}

function main(argv) {
	const repoAt = argv.indexOf("--repo");
	const repo = repoAt >= 0 ? argv[repoAt + 1] : process.env.GITHUB_REPOSITORY;
	const dryRun = argv.includes("--dry-run");
	const ageAt = argv.indexOf("--max-age-hours");
	const maxAgeHours = ageAt >= 0 ? Number(argv[ageAt + 1]) : DEFAULT_MAX_AGE_HOURS;
	const limitAt = argv.indexOf("--limit");
	const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) : DEFAULT_LIMIT;
	if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(maxAgeHours > 0) || !(limit > 0)) {
		console.error(
			"usage: rerun-startup-failed-runs.mjs --repo <owner/name> [--dry-run] [--max-age-hours 24] [--limit 20]",
		);
		return 2;
	}
	const sinceDate = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString().slice(0, 10);
	const failed = listRuns(repo, sinceDate);
	const pulls = failed.some((run) => run.event?.startsWith("pull_request")) ? listOpenPulls(repo) : [];
	const picked = startupFailedRuns(failed, { maxAgeHours, limit, pulls });
	let reran = 0;
	let errored = 0;
	for (const run of picked) {
		try {
			if (!dryRun) rerun(repo, run.id);
			console.log(`${dryRun ? "would rerun" : "requested rerun of"} ${run.id} ${run.name} (${run.event}, ${run.created_at})`);
			reran++;
		} catch (err) {
			console.error(`rerun of ${run.id} ${run.name} failed: ${`${err.stderr ?? ""}${err.message ?? ""}`.split("\n")[0]}`);
			errored++;
		}
	}
	console.log(`${picked.length} startup-failed run(s): ${reran} ${dryRun ? "would rerun" : "rerun"}, ${errored} failed`);
	// A single stubborn run (a deleted fork) is a warning; every attempt failing means the token or API is broken.
	return !dryRun && picked.length > 0 && errored === picked.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
