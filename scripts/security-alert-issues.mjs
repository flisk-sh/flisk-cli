#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Turns published dependency advisories into contributor-ready GitHub issues.
//
// Dependabot alerts and osv-scanner code-scanning alerts are the two sources. Every
// open alert becomes one issue that carries the advisory detail (severity, CVSS, CWE,
// affected range, patched version, references) so a contributor can pick it up without
// reading the advisory first. The issue closes itself again when the alert is fixed.
//
//   node scripts/security-alert-issues.mjs [--dry-run] [--repo owner/name]
//
// --dry-run prints every decision and writes nothing. Needs gh authenticated with
// security-events: read and issues: write.
//
// Only issues carrying MANAGED_LABEL are touched, so a hand-written issue is never
// rewritten or closed by this script.
//
// This file is the entry point: argument parsing, the gh calls and the orchestration
// live here. The pure logic sits in scripts/security-alert-issues/: alerts.mjs
// normalises the two alert sources, versions.mjs does the version maths, manifests.mjs
// reads the pinned versions, issues.mjs renders the title, labels and body, and
// plan.mjs decides the sync. Every export stays reachable from this module so
// existing imports keep working.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
	isAdvisory,
	MANAGED_LABEL,
	mergeAdvisory,
	normalizeCodeScanningAlert,
	normalizeDependabotAlert,
} from "./security-alert-issues/alerts.mjs";
import { bodyFor, labelsFor, managedLabelSet, titleFor } from "./security-alert-issues/issues.mjs";
import { assessFinding } from "./security-alert-issues/manifests.mjs";
import { finalLabelSet, planLabels, planSync } from "./security-alert-issues/plan.mjs";

export * from "./security-alert-issues/alerts.mjs";
export * from "./security-alert-issues/issues.mjs";
export * from "./security-alert-issues/manifests.mjs";
export * from "./security-alert-issues/plan.mjs";
export * from "./security-alert-issues/versions.mjs";

function gh(args, input) {
	return execFileSync("gh", args, {
		encoding: "utf8",
		input,
		maxBuffer: 64 * 1024 * 1024,
	});
}

/** `gh api --paginate --slurp` returns one array per page. */
function ghApiPages(path) {
	const parsed = JSON.parse(gh(["api", "--paginate", "--slurp", path]));
	return Array.isArray(parsed[0]) ? parsed.flat() : parsed;
}

/**
 * A source that is switched off (code scanning is not enabled everywhere) answers
 * 404. That is not a failure of the run: the other source still has work.
 */
function ghApiPagesOrEmpty(path, what) {
	try {
		return ghApiPages(path);
	} catch (error) {
		// gh puts the API's answer on stderr; the message alone does not say why.
		const reason = (error.stderr ?? error.message).toString().trim().split("\n")[0];
		console.log(`::warning::Could not read ${what}: ${reason}`);
		return [];
	}
}

function listOpenAlerts(repo) {
	return {
		dependabot: ghApiPagesOrEmpty(
			`repos/${repo}/dependabot/alerts?state=open&per_page=100`,
			"dependabot alerts",
		),
		"code-scanning": ghApiPagesOrEmpty(
			`repos/${repo}/code-scanning/alerts?state=open&per_page=100`,
			"code-scanning alerts",
		),
	};
}

function listManagedIssues(repo) {
	const pages = ghApiPages(
		`repos/${repo}/issues?state=all&labels=${encodeURIComponent(MANAGED_LABEL)}&per_page=100`,
	);
	return pages.filter((issue) => !issue.pull_request);
}

function globalAdvisory(ghsaId) {
	if (!ghsaId) return null;
	try {
		return JSON.parse(gh(["api", `advisories/${ghsaId}`]));
	} catch {
		return null;
	}
}

function existingLabels(repo) {
	return new Set(
		JSON.parse(gh(["label", "list", "--repo", repo, "--limit", "500", "--json", "name"])).map(
			(label) => label.name,
		),
	);
}

function ensureLabels(repo, wanted) {
	const existing = existingLabels(repo);
	const created = [];
	for (const [name, def] of wanted) {
		if (existing.has(name)) continue;
		gh([
			"label",
			"create",
			name,
			"--repo",
			repo,
			"--color",
			def.color,
			"--description",
			def.description,
		]);
		created.push(name);
	}
	return created;
}

function writeIssue(repo, action, findings) {
	const finding = action.finding;
	const body = action.body ?? bodyFor(finding, findings);
	const labels = action.labels ?? labelsFor(finding);
	if (action.action === "create") {
		const args = ["issue", "create", "--repo", repo, "--title", titleFor(finding), "--body-file", "-"];
		for (const label of labels) args.push("--label", label);
		const url = gh(args, body).trim();
		return { number: Number(url.split("/").pop()), url };
	}
	const issueNumber = action.issue.number;
	if (action.action === "reopen") {
		gh(["issue", "reopen", String(issueNumber), "--repo", repo]);
	}
	if (action.action === "update" || action.action === "reopen") {
		gh(
			["api", "--method", "PATCH", `repos/${repo}/issues/${issueNumber}`, "--input", "-"],
			JSON.stringify({ body, title: titleFor(finding) }),
		);
	}
	// Replace this script's own labels and leave the rest alone, so a `claimed`
	// label a contributor earned is never taken away.
	const managed = managedLabelSet(findings);
	const final = finalLabelSet(action.issue.labels, labels, managed);
	gh(
		["api", "--method", "PUT", `repos/${repo}/issues/${issueNumber}/labels`, "--input", "-"],
		JSON.stringify({ labels: final }),
	);
	return { number: issueNumber, url: action.issue.html_url };
}

function closeIssue(repo, issue) {
	gh([
		"issue",
		"close",
		String(issue.number),
		"--repo",
		repo,
		"--comment",
		"The advisory behind this issue no longer reports an open vulnerability, so it is closed. The issue stays as the record of the advisory.",
	]);
}

export function parseArgs(argv) {
	const out = {
		dryRun: false,
		repo: process.env.GITHUB_REPOSITORY ?? "flisk-sh/flisk",
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--dry-run") out.dryRun = true;
		else if (arg === "--repo") out.repo = argv[++i];
		else throw new Error(`unknown argument: ${arg}`);
	}
	return out;
}

function main(argv) {
	const opts = parseArgs(argv);
	const repo = opts.repo;
	const alerts = listOpenAlerts(repo);
	const findings = [];
	for (const alert of alerts.dependabot) {
		const finding = normalizeDependabotAlert(alert);
		// The alert carries the advisory, but the version range for a package can be
		// missing there. The global advisory lists the range and the fix per package
		// and ecosystem, so the two are read together.
		findings.push(mergeAdvisory(finding, globalAdvisory(finding.ghsaId)));
	}
	for (const alert of alerts["code-scanning"]) {
		const finding = mergeAdvisory(
			normalizeCodeScanningAlert(alert),
			globalAdvisory(normalizeCodeScanningAlert(alert).ghsaId),
		);
		if (!isAdvisory(finding)) {
			console.log(
				`::warning::Skipping code-scanning alert #${alert.number} (${alert.rule?.id ?? "unknown"}): not a published advisory.`,
			);
			continue;
		}
		findings.push(finding);
	}
	// The version the manifest pins decides whether the advisory reaches this
	// repository at all, so it is read next to the fixed version.
	for (let index = 0; index < findings.length; index += 1) {
		findings[index] = assessFinding(findings[index]);
	}
	const managed = listManagedIssues(repo);
	const actions = planSync(findings, managed);
	const wanted = planLabels(findings);

	// Labels first: an issue created without its labels would lose the severity and
	// package filters, and `gh issue create` refuses a label that does not exist.
	const created = opts.dryRun ? [] : ensureLabels(repo, wanted);
	if (created.length) console.log(`created labels: ${created.join(", ")}`);

	let failed = 0;
	for (const action of actions) {
		const label = action.finding
			? `${action.finding.key} ${action.finding.packageName ?? ""}`.trim()
			: `issue #${action.issue.number}`;
		console.log(`${action.action}: ${label}`);
		if (opts.dryRun) continue;
		// One issue that cannot be written must not stop the others: the next run
		// picks it up again, and the warning says which one failed.
		try {
			if (action.action === "close") {
				closeIssue(repo, action.issue);
				continue;
			}
			writeIssue(repo, action, findings);
		} catch (error) {
			failed += 1;
			const reason = (error.stderr ?? error.message).toString().trim().split("\n")[0];
			console.log(`::warning::Could not write ${label}: ${reason}`);
		}
	}
	console.log(
		`${findings.length} open alert(s), ${managed.length} managed issue(s), ${actions.length} action(s)`,
	);
	if (failed > 0) {
		console.log(`::warning::${failed} of ${actions.length} action(s) failed.`);
		return 1;
	}
	return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
