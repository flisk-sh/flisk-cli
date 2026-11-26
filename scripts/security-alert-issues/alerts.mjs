// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Alert normalisation for scripts/security-alert-issues.mjs.
//
// Dependabot alerts and osv-scanner code-scanning alerts arrive in two different
// shapes. This module turns both into one finding shape, keys and groups the
// findings, and merges the global advisory detail a code-scanning alert lacks.
//   node --test scripts/security-alert-issues/alerts.test.mjs

// Label every issue this script owns. Issues are found through it, so a human issue
// without the label is out of reach.
export const MANAGED_LABEL = "security-alert";

// The label an issue carries when the version the repository pins is not in the
// affected range: the advisory is real, this repository is not affected by it.
export const NOT_AFFECTED_LABEL = "not-affected";

// Hidden marker in the issue body. The alert number is the identity: an alert that
// reopens after a dismissal keeps the same number, so it maps back to the same issue.
export const MARKER_PREFIX = "<!-- flisk:security-alert:";
export const MARKER_SUFFIX = " -->";

/**
 * The key of a finding: the advisory and the manifest it applies to.
 *
 * The same advisory shows up in more than one source (Dependabot and the osv-scanner
 * both report it), and a repository can hold the same advisory in more than one
 * manifest. Keying on the advisory and the manifest gives one issue per thing to fix,
 * whichever source reported it and however many scanners see it.
 */
export function findingKey(finding) {
	const advisory = finding.ghsaId ?? finding.cveId ?? finding.packageName ?? "advisory";
	const manifest = finding.manifestPath ?? "repository";
	return `${advisory}|${manifest}`.replace(/[^A-Za-z0-9._|/-]+/g, "-");
}

/**
 * Whether two findings are the same thing to fix: the same advisory in the same
 * manifest. One source may know the GHSA and the other only the CVE, so either
 * identifier is enough.
 */
export function sameAdvisory(a, b) {
	if ((a.manifestPath ?? "repository") !== (b.manifestPath ?? "repository")) return false;
	if (a.ghsaId && b.ghsaId && a.ghsaId === b.ghsaId) return true;
	return Boolean(a.cveId && b.cveId && a.cveId === b.cveId);
}

/**
 * The key of a group of findings that are the same thing to fix. The GHSA is used
 * when the group has one, because every source reports it; the CVE is the fallback.
 */
export function groupKey(findings) {
	const ghsa = findings.find((finding) => finding.ghsaId)?.ghsaId;
	const cve = findings.find((finding) => finding.cveId)?.cveId;
	const advisory = ghsa ?? cve ?? findings[0].packageName ?? "advisory";
	const manifest = findings[0].manifestPath ?? "repository";
	return `${advisory}|${manifest}`.replace(/[^A-Za-z0-9._|/-]+/g, "-");
}

/** The findings that are the same thing to fix, grouped. The first one leads each group. */
export function groupFindings(findings) {
	const groups = [];
	for (const finding of findings) {
		const group = groups.find((candidate) => sameAdvisory(candidate[0], finding));
		if (group) group.push(finding);
		else groups.push([finding]);
	}
	return groups;
}

/** Marker for one finding. Stable across runs: the same finding always maps to the same issue. */
export function markerFor(key) {
	return `${MARKER_PREFIX}${key}${MARKER_SUFFIX}`;
}

/** The finding a body belongs to, or null when the body carries no marker. */
export function parseMarker(body) {
	// The colon is allowed so a marker in the older `source:number` shape is still read:
	// no finding carries such a key, so the sync closes that issue instead of leaving
	// it open for ever.
	const match = /<!-- flisk:security-alert:([A-Za-z0-9._:|/-]+) -->/.exec(body ?? "");
	if (!match) return null;
	return { key: match[1] };
}

/** GitHub severity, normalised. Unknown values are treated as medium. */
export function normalizeSeverity(severity) {
	const value = String(severity ?? "").toLowerCase();
	if (value === "critical") return "critical";
	if (value === "high") return "high";
	if (value === "medium" || value === "moderate") return "medium";
	if (value === "low") return "low";
	return "medium";
}

/** "Package 'vite@8.3.1' is vulnerable to 'CVE-...' (also known as 'GHSA-...')." */
export function parseScannerMessage(message) {
	const text = message ?? "";
	const pkg = /Package '([^@']+)@([^']+)'/.exec(text);
	const ghsa = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(text);
	const cve = /CVE-\d{4}-\d+/i.exec(text);
	return {
		packageName: pkg ? pkg[1] : null,
		installedVersion: pkg ? pkg[2] : null,
		ghsaId: ghsa ? ghsa[0] : null,
		cveId: cve ? cve[0] : null,
	};
}

/** A Dependabot alert, in the shape both sources share. */
export function normalizeDependabotAlert(alert) {
	const advisory = alert.security_advisory ?? {};
	const vuln =
		vulnerabilityEntry(alert.security_vulnerabilities, alert.dependency?.package?.ecosystem) ?? {};
	const finding = {
		source: "dependabot",
		alertNumber: alert.number,
		alertUrl: alert.html_url,
		title: advisory.summary ?? advisory.description?.split("\n")[0] ?? "Dependency advisory",
		severity: normalizeSeverity(advisory.severity),
		cvssScore: advisory.cvss?.score ?? null,
		cvssVector: advisory.cvss?.vector_string ?? null,
		ghsaId: advisory.ghsa_id ?? null,
		cveId: advisory.cve_id ?? null,
		packageName: alert.dependency?.package?.name ?? null,
		ecosystem: alert.dependency?.package?.ecosystem ?? null,
		manifestPath: alert.dependency?.manifest_path ?? null,
		scope: alert.dependency?.scope ?? null,
		vulnerableRange: vuln.vulnerable_version_range ?? null,
		patchedVersion: versionOf(vuln.first_patched_version) ?? null,
		installedVersion: null,
		description: advisory.description ?? "",
		cwes: (advisory.cwes ?? []).map((cwe) => ({
			id: cwe.cwe_id,
			name: cwe.name,
			description: cwe.description,
		})),
		references: advisory.references ?? [],
		publishedAt: advisory.published_at ?? null,
	};
	finding.key = findingKey(finding);
	return finding;
}

/** A code-scanning alert. osv-scanner fills the rule, not `security_advisory`. */
export function normalizeCodeScanningAlert(alert) {
	const instance = alert.most_recent_instance ?? {};
	const parsed = parseScannerMessage(instance.message?.text ?? "");
	const rule = alert.rule ?? {};
	const finding = {
		source: "code-scanning",
		alertNumber: alert.number,
		alertUrl: alert.html_url,
		title: rule.description?.split("\n")[0] ?? parsed.ghsaId ?? "Scanner alert",
		severity: normalizeSeverity(rule.severity),
		cvssScore: null,
		cvssVector: null,
		ghsaId: parsed.ghsaId,
		cveId: parsed.cveId,
		packageName: parsed.packageName,
		ecosystem: null,
		manifestPath: instance.location?.path ?? null,
		scope: null,
		vulnerableRange: null,
		patchedVersion: null,
		installedVersion: parsed.installedVersion,
		description: rule.full_description ?? rule.description ?? "",
		cwes: [],
		references: [],
		publishedAt: null,
	};
	finding.key = findingKey(finding);
	return finding;
}

/** A version arrives as a plain string from the global advisory API and as an object from the Dependabot API. */
export function versionOf(value) {
	if (typeof value === "string") return value;
	return value?.identifier ?? null;
}

/**
 * The vulnerability entry for one ecosystem.
 *
 * An advisory lists one entry per ecosystem a package is published for, and the
 * entries carry different ranges, so the entry of the ecosystem the alert names is
 * the one that says anything about this repository.
 */
export function vulnerabilityEntry(vulnerabilities, ecosystem) {
	const list = vulnerabilities ?? [];
	if (!list.length) return null;
	return (
		list.find((entry) => ecosystem && entry?.package?.ecosystem === ecosystem) ??
		list.find((entry) => entry?.vulnerable_version_range || entry?.first_patched_version) ??
		list[0]
	);
}

/**
 * The entry of the global advisory that belongs to this finding: the same package
 * and ecosystem first, then the same package, and only then the first entry, which
 * may belong to another package entirely.
 */
export function advisoryEntry(advisory, finding) {
	const list = advisory?.vulnerabilities ?? [];
	if (!list.length) return null;
	return (
		list.find(
			(entry) =>
				entry?.package?.name === finding.packageName &&
				entry?.package?.ecosystem === finding.ecosystem,
		) ??
		list.find((entry) => entry?.package?.name === finding.packageName) ??
		list[0]
	);
}

/**
 * Fill the gaps a code-scanning alert leaves (severity, CVSS, CWE, patched version)
 * from the global advisory the alert points at.
 */
export function mergeAdvisory(finding, advisory) {
	if (!advisory) return finding;
	// The advisory lists every affected package. The entry for this package carries the
	// range and the fix that matter here; the first one may belong to another package.
	const entry = advisoryEntry(advisory, finding);
	return {
		...finding,
		title: finding.title || advisory.summary,
		severity: normalizeSeverity(advisory.severity),
		cvssScore: advisory.cvss?.score ?? finding.cvssScore,
		cvssVector: advisory.cvss?.vector_string ?? finding.cvssVector,
		ghsaId: finding.ghsaId ?? advisory.ghsa_id ?? null,
		cveId: finding.cveId ?? advisory.cve_id ?? null,
		vulnerableRange: finding.vulnerableRange ?? entry?.vulnerable_version_range ?? null,
		patchedVersion: finding.patchedVersion ?? versionOf(entry?.first_patched_version) ?? null,
		description: finding.description || advisory.description || "",
		cwes: finding.cwes.length
			? finding.cwes
			: (advisory.cwes ?? []).map((cwe) => ({
					id: cwe.cwe_id,
					name: cwe.name,
					description: cwe.description,
				})),
		references: finding.references.length ? finding.references : (advisory.references ?? []),
		publishedAt: finding.publishedAt ?? advisory.published_at ?? null,
	};
}

/**
 * Whether a finding is about a published advisory.
 *
 * The code-scanning results carry more than advisories: Semgrep's SAST rules and the
 * OpenSSF Scorecard rules land there too. Those are not advisories, have no CVE or
 * GHSA to link, and a contributor cannot fix them by bumping a version, so they are
 * not turned into issues here.
 */
export function isAdvisory(finding) {
	if (finding.source === "dependabot") return true;
	return Boolean(finding.packageName && (finding.ghsaId || finding.cveId));
}
