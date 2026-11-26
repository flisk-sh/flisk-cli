// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Issue rendering for scripts/security-alert-issues.mjs: the title, labels and body
// text an issue for one finding carries. Nothing here talks to GitHub.
//   node --test scripts/security-alert-issues/issues.test.mjs
import { MANAGED_LABEL, markerFor, NOT_AFFECTED_LABEL, normalizeSeverity } from "./alerts.mjs";

// Labels with a fixed meaning, created when missing.
export const LABEL_DEFS = {
	security: { color: "1d76db", description: "Discussion topic" },
	vulnerability: {
		color: "d73a4a",
		description: "A published advisory affects a dependency in this repository",
	},
	"security-alert": {
		color: "b60205",
		description: "Created from a Dependabot or code-scanning alert by a workflow",
	},
	"auto-generated": {
		color: "ededed",
		description: "Written by a workflow, not by a person",
	},
	"area: dependencies": {
		color: "ededed",
		description: "Dependency manifests and lockfiles",
	},
	dependencies: {
		color: "0366d6",
		description: "Pull requests that update a dependency file",
	},
	"supply-chain": {
		color: "1d76db",
		description: "Discussion topic",
	},
	"help wanted": {
		color: "008672",
		description: "Extra attention is needed",
	},
	"not-affected": {
		color: "c2e0c6",
		description: "The advisory does not affect the version the repository pins",
	},
	windows: { color: "5319e7", description: "Windows and WSL2 support" },
};

const SEVERITY_COLORS = {
	low: "0e8a16",
	medium: "fbca04",
	high: "d93f0b",
	critical: "b60205",
};
const SOURCE_COLORS = {
	dependabot: "0366d6",
	"code-scanning": "8250df",
};
const SCOPE_COLORS = {
	runtime: "d93f0b",
	development: "c2e0c6",
};

/** Package names become label names, so the characters GitHub forbids are removed. */
export function sanitizeLabelPart(value) {
	const label = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-");
	let start = 0;
	let end = label.length;
	while (start < end && label[start] === "-") start++;
	while (end > start && label[end - 1] === "-") end--;
	return label.slice(start, end);
}

/** The label set for one finding. */
export function labelsFor(finding) {
	const labels = new Set([
		"security",
		MANAGED_LABEL,
		"auto-generated",
		"area: dependencies",
		"dependencies",
		"supply-chain",
		`severity: ${normalizeSeverity(finding.severity)}`,
		`source: ${finding.source}`,
	]);
	// A finding the repository is not affected by is not a vulnerability here and
	// nobody is asked to take it up, so it does not carry those two labels.
	if (isNotAffected(finding)) {
		labels.add(NOT_AFFECTED_LABEL);
	} else {
		labels.add("vulnerability");
		labels.add("help wanted");
	}
	const pkg = sanitizeLabelPart(finding.packageName);
	if (pkg) labels.add(`package: ${pkg}`);
	const ecosystem = sanitizeLabelPart(finding.ecosystem);
	if (ecosystem) labels.add(`ecosystem: ${ecosystem}`);
	const scope = sanitizeLabelPart(finding.scope);
	if (scope) labels.add(`scope: ${scope}`);
	for (const cwe of (finding.cwes ?? []).slice(0, 3)) {
		const id = sanitizeLabelPart(String(cwe.id ?? "").replace(/^CWE-/, ""));
		if (id) labels.add(`cwe: ${id}`);
	}
	// The Windows advisories are the ones that turn a dependency bump into a real
	// exposure, so they get the platform label contributors filter on.
	const text = `${finding.title ?? ""} ${finding.description ?? ""}`;
	if (/windows|win32|\bntlm\b/i.test(text)) labels.add("windows");
	return [...labels].sort((a, b) => a.localeCompare(b));
}

/**
 * The label namespaces this script owns: a fixed set, plus every dynamic label
 * (severity, source, package, ecosystem, scope, weakness).
 *
 * The namespaces are owned rather than the exact labels of the current finding, so a
 * label left over from an earlier run — a `severity: medium` on an advisory that is
 * high now — is replaced instead of kept next to the new one. Labels outside these
 * namespaces belong to people.
 */
export const MANAGED_LABEL_PREFIXES = [
	"severity: ",
	"source: ",
	"package: ",
	"ecosystem: ",
	"scope: ",
	"cwe: ",
];

/** Every label this script can apply. Labels outside this set belong to people. */
export function managedLabelSet(findings) {
	const labels = new Set(Object.keys(LABEL_DEFS));
	for (const finding of findings) {
		for (const label of labelsFor(finding)) labels.add(label);
	}
	return labels;
}

/** Whether a label belongs to a namespace this script owns. */
export function isManagedLabel(label, managed) {
	if (managed.has(label)) return true;
	return MANAGED_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

/** The title of the issue for one finding. */
export function titleFor(finding) {
	const summary = (finding.title ?? "Dependency advisory").replace(/\s+/g, " ").trim();
	const manifest = finding.manifestPath ? ` (${finding.manifestPath})` : "";
	return `[security] ${finding.packageName ?? "dependency"}: ${summary}${manifest}`;
}

/** Whether the version the repository pins is outside the affected range. */
export function isNotAffected(finding) {
	return finding.assessment?.status === "not-affected";
}

/** A one-line summary of the finding, used as the issue lede. */
export function ledeFor(finding) {
	const where = finding.manifestPath ? ` as resolved in \`${finding.manifestPath}\`` : "";
	const patched = finding.patchedVersion
		? `The fix is ${finding.patchedVersion}.`
		: "No patched version is published yet.";
	if (isNotAffected(finding)) {
		const manifest = finding.manifestPath ? `\`${finding.manifestPath}\`` : "the manifest";
		return (
			`A published advisory affects **${finding.packageName ?? "a dependency"}**, ` +
			`but the version ${manifest} pins is not in the affected range. ${patched}`
		);
	}
	return `A published advisory affects **${finding.packageName ?? "a dependency"}**${where}. ${patched}`;
}

/**
 * What the version the manifest pins means for this repository, in words.
 *
 * The pinned version and the fixed version stand next to each other, so a reader can
 * see the call without opening the advisory.
 */
export function affectedText(finding) {
	const assessment = finding.assessment;
	if (!assessment) return "";
	const where = finding.manifestPath ? `\`${finding.manifestPath}\`` : "the manifest";
	const packageName = finding.packageName ?? "the dependency";
	if (assessment.status === "unknown") {
		return (
			`The version ${where} pins for **${packageName}** could not be read: ` +
			`${assessment.reason}. Whether this repository is affected is a judgement for a person.`
		);
	}
	const fixed = finding.patchedVersion
		? `the advisory is fixed in **${finding.patchedVersion}**`
		: "the advisory lists no fixed version";
	return (
		`${where} pins **${packageName} ${finding.pinned?.version}**; ${fixed}. ` +
		`${assessment.verdict} — ${assessment.reason}.`
	);
}

/** Other open findings for the same advisory, so one fix can be read in one place. */
export function relatedFindings(finding, findings) {
	return findings.filter(
		(other) =>
			other.key !== finding.key &&
			((finding.ghsaId && other.ghsaId === finding.ghsaId) ||
				(finding.cveId && other.cveId === finding.cveId)),
	);
}

// GitHub rejects an issue body over 65536 characters, and an advisory can carry a
// long proof of concept. Keep the whole text up to a size that always fits.
const MAX_DESCRIPTION = 20000;

/** Shorten text that would make the issue body too long to post. */
export function truncate(text, limit = MAX_DESCRIPTION) {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n\n_(truncated; read the full advisory at the link above)_`;
}

/** The issue body. Every field the advisory gives us, so the issue stands on its own. */
export function bodyFor(finding, findings = []) {
	const lines = [markerFor(finding.key), "", ledeFor(finding), ""];
	lines.push("## Advisory", "");
	if (finding.ghsaId) {
		lines.push(`- GHSA: [${finding.ghsaId}](https://github.com/advisories/${finding.ghsaId})`);
	}
	if (finding.cveId) {
		lines.push(`- CVE: [${finding.cveId}](https://www.cve.org/CVERecord?id=${finding.cveId})`);
	}
	lines.push(`- Severity: **${normalizeSeverity(finding.severity)}**`);
	if (finding.cvssScore) {
		const vector = finding.cvssVector ? ` (\`${finding.cvssVector}\`)` : "";
		lines.push(`- CVSS: ${finding.cvssScore}${vector}`);
	}
	if (finding.publishedAt) lines.push(`- Published: ${finding.publishedAt.slice(0, 10)}`);
	if (finding.alertUrl) lines.push(`- Alert: ${finding.alertUrl}`);
	lines.push("");

	lines.push("## Affected dependency", "");
	lines.push("| Field | Value |", "| --- | --- |");
	lines.push(`| Package | \`${finding.packageName ?? "unknown"}\` |`);
	if (finding.ecosystem) lines.push(`| Ecosystem | ${finding.ecosystem} |`);
	if (finding.manifestPath) lines.push(`| Manifest | \`${finding.manifestPath}\` |`);
	if (finding.installedVersion) {
		lines.push(`| Resolved version | \`${finding.installedVersion}\` |`);
	}
	if (finding.pinned?.version) {
		lines.push(`| Pinned version | \`${finding.pinned.version}\` |`);
	}
	if (finding.vulnerableRange) {
		lines.push(`| Vulnerable range | \`${finding.vulnerableRange}\` |`);
	}
	if (finding.patchedVersion) lines.push(`| Patched version | \`${finding.patchedVersion}\` |`);
	if (finding.scope) lines.push(`| Scope | ${finding.scope} |`);
	lines.push("");

	if (finding.assessment) {
		lines.push("## Is this repository affected?", "", affectedText(finding), "");
	}

	if ((finding.cwes ?? []).length) {
		lines.push("## Weakness", "");
		for (const cwe of finding.cwes) {
			lines.push(`- ${cwe.id}: ${cwe.name ?? ""}`.trimEnd());
		}
		lines.push("");
	}

	if (finding.description) {
		lines.push("## Description", "", truncate(finding.description.trim()), "");
	}

	if ((finding.references ?? []).length) {
		lines.push("## References", "");
		for (const reference of finding.references) {
			const url = typeof reference === "string" ? reference : reference.url;
			if (url) lines.push(`- ${url}`);
		}
		lines.push("");
	}

	const related = relatedFindings(finding, findings);
	if (related.length) {
		lines.push("## Also affected", "");
		for (const other of related) {
			const where = other.manifestPath ? `\`${other.manifestPath}\`` : "another manifest";
			lines.push(`- ${other.packageName ?? "the same package"} in ${where}`);
		}
		lines.push("");
	}

	lines.push("## How to fix", "");
	if (isNotAffected(finding)) {
		lines.push(
			"No version bump is needed: the version this repository pins is not in the affected range.",
			"",
		);
		const dismiss = finding.source === "dependabot" ? " with the reason `inaccurate`" : "";
		lines.push(
			`1. A maintainer dismisses the alert${
				finding.alertUrl ? ` at ${finding.alertUrl}` : ""
			}${dismiss}, so the queue stops asking for a fix that is not needed.`,
			"2. The issue stays as the record of the advisory.",
			"",
		);
	} else {
		const steps = [];
		if (finding.assessment?.status === "unknown") {
			steps.push(
				`Confirm whether the pinned version is affected: ${finding.assessment.reason}, ` +
					"so a person makes the call.",
			);
		}
		if (finding.patchedVersion) {
			steps.push(
				`Bump \`${finding.packageName ?? "the dependency"}\` to \`${finding.patchedVersion}\`` +
					`${finding.manifestPath ? ` in \`${finding.manifestPath}\`` : ""} and in every other manifest that pins it.`,
				"Regenerate the lockfile with the package manager that manifest uses.",
			);
		} else {
			steps.push(
				`No patched version of \`${finding.packageName ?? "the dependency"}\` is published yet.` +
					`${
						finding.manifestPath
							? ` Until one is, keep \`${finding.manifestPath}\` off the affected range by pinning a version that is not in it.`
							: " Until one is, keep the affected version out of the manifests that ship to users."
					}`,
				"Watch the advisory for the fix, and take the step above as soon as it lands.",
			);
		}
		steps.push(
			"Run the checks: `bun run typecheck`, `bun run lint`, `bun run test`.",
			"Open a pull request that says `Fixes #<this issue number>`.",
		);
		steps.forEach((step, index) => {
			lines.push(`${index + 1}. ${step}`);
		});
		lines.push("");
	}
	if (isNotAffected(finding)) {
		lines.push(
			"## Picking this up",
			"",
			"No contributor work is needed here. A maintainer dismisses the alert; the issue stays as the record.",
			"",
		);
	} else {
		lines.push(
			"## Picking this up",
			"",
			"Comment `I'll take this` to be assigned. A draft pull request is welcome at any stage;",
			"sign the commits off with `git commit -s`.",
			"",
		);
	}
	lines.push(
		"_This issue is written by the security-alert-issues workflow and closes itself when the alert is fixed._",
		"",
	);
	return lines.join("\n");
}

/** The colour of a dynamic label, picked from the kind of value it carries. */
export function colorForLabel(label) {
	const value = label.includes(": ") ? label.split(": ").slice(1).join(": ") : "";
	if (label.startsWith("severity: ")) return SEVERITY_COLORS[value] ?? "fbca04";
	if (label.startsWith("source: ")) return SOURCE_COLORS[value] ?? "0366d6";
	if (label.startsWith("scope: ")) return SCOPE_COLORS[value] ?? "c2e0c6";
	if (label.startsWith("cwe: ")) return "5319e7";
	return "1d76db";
}
