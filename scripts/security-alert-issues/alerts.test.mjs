// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for scripts/security-alert-issues/alerts.mjs.
//   node --test scripts/security-alert-issues/alerts.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	advisoryEntry,
	findingKey,
	groupFindings,
	groupKey,
	isAdvisory,
	markerFor,
	mergeAdvisory,
	normalizeCodeScanningAlert,
	normalizeDependabotAlert,
	normalizeSeverity,
	parseMarker,
	parseScannerMessage,
	sameAdvisory,
	versionOf,
	vulnerabilityEntry,
} from "./alerts.mjs";

const DEPENDABOT_ALERT = {
	number: 22,
	html_url: "https://github.com/flisk-sh/flisk-cli/security/dependabot/22",
	dependency: {
		package: { name: "vite", ecosystem: "npm" },
		manifest_path: "cli/pnpm-lock.yaml",
		scope: "development",
	},
	security_advisory: {
		ghsa_id: "GHSA-698v-4r3x-3vcv",
		cve_id: "CVE-2026-112943",
		summary: "launch-editor: escapeCmdArgs() omits % escaping on Windows",
		description: "launch-editor did not escape % on Windows when passing an argument to cmd.",
		severity: "medium",
		cvss: { score: 5.3, vector_string: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:L" },
		cwes: [{ cwe_id: "CWE-77", name: "Command injection" }],
		references: [{ url: "https://example.test/advisory" }],
		published_at: "2026-10-20T18:30:00Z",
	},
	security_vulnerabilities: [
		{
			package: { name: "vite", ecosystem: "npm" },
			vulnerable_version_range: ">= 7.0.0, < 7.3.7",
			first_patched_version: { identifier: "7.3.7" },
		},
	],
};

const SCANNER_ALERT = {
	number: 456,
	html_url: "https://github.com/flisk-sh/flisk-cli/security/code-scanning/456",
	rule: {
		id: "CVE-2026-112942",
		severity: "warning",
		description: "CVE-2026-112942: launch-editor exists on Windows",
		full_description: "launch-editor checked fs.existsSync(fileName) first.",
	},
	most_recent_instance: {
		location: { path: "bun.lock" },
		message: {
			text: "Package 'vite@8.3.1' is vulnerable to 'CVE-2026-112942' (also known as 'GHSA-587h-7wmj-h5pm').",
		},
	},
};

test("the key prefers the GHSA, then the CVE, then the package", () => {
	assert.equal(
		findingKey({ ghsaId: "GHSA-a", cveId: "CVE-1", manifestPath: "m" }),
		"GHSA-a|m",
	);
	assert.equal(findingKey({ cveId: "CVE-1", manifestPath: "m" }), "CVE-1|m");
	assert.equal(findingKey({ packageName: "vite", manifestPath: "m" }), "vite|m");
	assert.equal(findingKey({}), "advisory|repository");
	// Characters a GitHub marker cannot carry are replaced.
	assert.equal(findingKey({ ghsaId: "GHSA a", manifestPath: "dir/file lock" }), "GHSA-a|dir/file-lock");
	// Slashes survive: the marker charset allows them.
	assert.equal(
		findingKey({ packageName: "@scope/pkg", manifestPath: "my dir/x y.txt" }),
		"-scope/pkg|my-dir/x-y.txt",
	);
});

test("two findings are the same advisory by GHSA or CVE, in one manifest", () => {
	const a = { ghsaId: "GHSA-a", manifestPath: "m" };
	assert.equal(sameAdvisory(a, { ghsaId: "GHSA-a", manifestPath: "m" }), true);
	assert.equal(sameAdvisory({ cveId: "CVE-1", manifestPath: "m" }, { cveId: "CVE-1", manifestPath: "m" }), true);
	// Different manifests are different work even for the same advisory.
	assert.equal(sameAdvisory(a, { ghsaId: "GHSA-a", manifestPath: "other" }), false);
	// A missing manifest counts as the repository manifest.
	assert.equal(sameAdvisory(a, { ghsaId: "GHSA-a" }), false);
	assert.equal(sameAdvisory({ ghsaId: "GHSA-a" }, { ghsaId: "GHSA-a" }), true);
	// A different GHSA with the same CVE still matches: either identifier is enough.
	assert.equal(
		sameAdvisory(
			{ ghsaId: "GHSA-a", cveId: "CVE-1", manifestPath: "m" },
			{ ghsaId: "GHSA-b", cveId: "CVE-1", manifestPath: "m" },
		),
		true,
	);
	// Neither identifier matching is not a match.
	assert.equal(sameAdvisory({ ghsaId: "GHSA-a", manifestPath: "m" }, { cveId: "CVE-2", manifestPath: "m" }), false);
});

test("the group key takes the GHSA the group knows", () => {
	assert.equal(
		groupKey([{ cveId: "CVE-1" }, { ghsaId: "GHSA-a", cveId: "CVE-1" }]),
		"GHSA-a|repository",
	);
	assert.equal(groupKey([{ cveId: "CVE-1" }, { cveId: "CVE-1" }]), "CVE-1|repository");
	assert.equal(groupKey([{ packageName: "vite", manifestPath: "a.txt" }]), "vite|a.txt");
});

test("grouping keeps the first finding of each advisory in front", () => {
	const a = { ghsaId: "GHSA-a", cveId: "CVE-1", manifestPath: "m" };
	const b = { cveId: "CVE-1", manifestPath: "m" };
	const c = { ghsaId: "GHSA-c", manifestPath: "m" };
	const groups = groupFindings([a, b, c]);
	assert.equal(groups.length, 2);
	assert.equal(groups[0][0], a);
	assert.equal(groups[0].length, 2);
	assert.equal(groups[1][0], c);
});

test("grouping is not transitive: a finding is compared to the group leader only", () => {
	// b joins a's group through the GHSA. c shares the CVE with b but not with the
	// leader a, so it starts a new group even though it is the same advisory as b.
	const a = { ghsaId: "GHSA-a", cveId: "CVE-1", manifestPath: "m" };
	const b = { ghsaId: "GHSA-a", cveId: "CVE-2", manifestPath: "m" };
	const c = { cveId: "CVE-2", manifestPath: "m" };
	const groups = groupFindings([a, b, c]);
	assert.equal(groups.length, 2);
	assert.deepEqual(groups[1], [c]);
});

test("a marker in the older source:number shape still parses", () => {
	assert.deepEqual(parseMarker("<!-- flisk:security-alert:dependabot:12 -->"), {
		key: "dependabot:12",
	});
	// A key with a colon round-trips.
	const marker = markerFor("dependabot:12");
	assert.deepEqual(parseMarker(marker), { key: "dependabot:12" });
});

test("severity falls back to medium for anything unknown", () => {
	for (const value of ["error", "warning", "note", "none", "", 0, false]) {
		assert.equal(normalizeSeverity(value), "medium", `severity: ${value}`);
	}
	assert.equal(normalizeSeverity("HIGH"), "high");
	assert.equal(normalizeSeverity("Critical"), "critical");
});

test("a scanner message without a package yields only the ids it carries", () => {
	const parsed = parseScannerMessage("GHSA-aaaa-bbbb-cccc reported");
	assert.equal(parsed.packageName, null);
	assert.equal(parsed.installedVersion, null);
	assert.equal(parsed.ghsaId, "GHSA-aaaa-bbbb-cccc");
	assert.equal(parsed.cveId, null);
	const cveOnly = parseScannerMessage("CVE-2026-99999 found");
	assert.equal(cveOnly.cveId, "CVE-2026-99999");
	assert.equal(cveOnly.ghsaId, null);
});

test("a scoped package name is not read from the scanner message", () => {
	// Current limitation, pinned: `[^@']+` cannot match the leading @, so a scoped
	// npm package yields no package name and the alert is then skipped by isAdvisory.
	const parsed = parseScannerMessage(
		"Package '@scope/pkg@1.2.3' is vulnerable to 'CVE-2026-1111' (also known as 'GHSA-aaaa-bbbb-cccc').",
	);
	assert.equal(parsed.packageName, null);
	assert.equal(parsed.installedVersion, null);
	assert.equal(parsed.ghsaId, "GHSA-aaaa-bbbb-cccc");
});

test("a dependabot alert without an advisory gets the defaults", () => {
	const finding = normalizeDependabotAlert({ number: 5 });
	assert.equal(finding.title, "Dependency advisory");
	assert.equal(finding.severity, "medium");
	assert.equal(finding.packageName, null);
	assert.equal(finding.vulnerableRange, null);
	assert.equal(finding.patchedVersion, null);
	assert.deepEqual(finding.cwes, []);
	assert.equal(finding.key, "advisory|repository");
});

test("the dependabot title falls back to the first description line", () => {
	const finding = normalizeDependabotAlert({
		number: 5,
		security_advisory: { description: "first line\nsecond line" },
	});
	assert.equal(finding.title, "first line");
});

test("a dependabot alert picks the vulnerability entry of its ecosystem", () => {
	const alert = {
		...DEPENDABOT_ALERT,
		security_vulnerabilities: [
			{
				package: { name: "vite", ecosystem: "cargo" },
				vulnerable_version_range: "< 1.0.0",
				first_patched_version: "1.0.0",
			},
			{
				package: { name: "vite", ecosystem: "npm" },
				vulnerable_version_range: ">= 7.0.0, < 7.3.7",
				first_patched_version: "7.3.7",
			},
		],
	};
	const finding = normalizeDependabotAlert(alert);
	assert.equal(finding.vulnerableRange, ">= 7.0.0, < 7.3.7");
	assert.equal(finding.patchedVersion, "7.3.7");
});

test("a code-scanning alert without a rule falls back to the GHSA, then a default", () => {
	const alert = {
		number: 1,
		most_recent_instance: {
			message: { text: "Package 'a@1.0' is vulnerable to 'GHSA-aaaa-bbbb-cccc'." },
		},
	};
	assert.equal(normalizeCodeScanningAlert(alert).title, "GHSA-aaaa-bbbb-cccc");
	const bare = normalizeCodeScanningAlert({ number: 2 });
	assert.equal(bare.title, "Scanner alert");
	assert.equal(bare.manifestPath, null);
});

test("the scanner description prefers the full rule text", () => {
	const finding = normalizeCodeScanningAlert(SCANNER_ALERT);
	assert.equal(finding.description, "launch-editor checked fs.existsSync(fileName) first.");
	const shortOnly = normalizeCodeScanningAlert({
		number: 1,
		rule: { description: "short" },
		most_recent_instance: {},
	});
	assert.equal(shortOnly.description, "short");
});

test("a version reads as a string, an identifier object, or null", () => {
	assert.equal(versionOf(5), null);
	assert.equal(versionOf({}), null);
	assert.equal(versionOf({ identifier: "1.2.3" }), "1.2.3");
});

test("the vulnerability entry falls back to the entry that carries data", () => {
	const entries = [
		{ package: { name: "a", ecosystem: "npm" } },
		{ package: { name: "b", ecosystem: "pip" }, vulnerable_version_range: "< 2.0" },
	];
	assert.equal(vulnerabilityEntry(entries, "cargo").vulnerable_version_range, "< 2.0");
	assert.equal(vulnerabilityEntry([], "npm"), null);
	assert.equal(vulnerabilityEntry(null, "npm"), null);
	const bare = [{ package: { name: "a" } }, { package: { name: "b" } }];
	assert.equal(vulnerabilityEntry(bare, "cargo").package.name, "a");
});

test("the advisory entry prefers the same package and ecosystem", () => {
	const advisory = {
		vulnerabilities: [
			{ package: { name: "vite", ecosystem: "cargo" }, first_patched_version: "0.0.1" },
			{ package: { name: "other", ecosystem: "npm" }, first_patched_version: "2.0.0" },
			{ package: { name: "vite", ecosystem: "npm" }, first_patched_version: "8.3.3" },
		],
	};
	assert.equal(
		advisoryEntry(advisory, { packageName: "vite", ecosystem: "npm" }).first_patched_version,
		"8.3.3",
	);
	// Same package, different ecosystem: the package match wins over the first entry.
	assert.equal(
		advisoryEntry(advisory, { packageName: "other", ecosystem: "cargo" }).first_patched_version,
		"2.0.0",
	);
	// No package match at all: the first entry, whatever it belongs to.
	assert.equal(
		advisoryEntry(advisory, { packageName: "missing", ecosystem: "npm" }).first_patched_version,
		"0.0.1",
	);
	assert.equal(advisoryEntry(null, {}), null);
	assert.equal(advisoryEntry({}, {}), null);
});

test("the merge keeps the detail the alert already carries", () => {
	const finding = {
		title: "scanner title",
		cwes: [{ id: "CWE-1" }],
		references: ["https://example.test/mine"],
		vulnerableRange: ">= 1.0, < 2.0",
		patchedVersion: "2.0.0",
		publishedAt: "2026-01-01",
		description: "mine",
		ghsaId: "GHSA-own",
		cveId: "CVE-own",
	};
	const merged = mergeAdvisory(finding, {
		summary: "advisory title",
		severity: "high",
		cwes: [{ cwe_id: "CWE-2" }],
		references: [{ url: "https://example.test/theirs" }],
		description: "theirs",
		published_at: "2026-02-02",
		vulnerabilities: [
			{ vulnerable_version_range: "< 9.9", first_patched_version: "9.9.9" },
		],
	});
	assert.equal(merged.title, "scanner title");
	assert.equal(merged.description, "mine");
	assert.equal(merged.vulnerableRange, ">= 1.0, < 2.0");
	assert.equal(merged.patchedVersion, "2.0.0");
	assert.equal(merged.publishedAt, "2026-01-01");
	assert.deepEqual(merged.cwes, [{ id: "CWE-1" }]);
	assert.deepEqual(merged.references, ["https://example.test/mine"]);
	assert.equal(merged.ghsaId, "GHSA-own");
	assert.equal(merged.cveId, "CVE-own");
});

test("the merge fills what the alert lacks", () => {
	const finding = {
		title: "",
		cwes: [],
		references: [],
		description: "",
		ghsaId: null,
		cveId: null,
		publishedAt: null,
	};
	const merged = mergeAdvisory(finding, {
		summary: "advisory title",
		severity: "critical",
		cwes: [{ cwe_id: "CWE-89", name: "SQL injection" }],
		references: [{ url: "https://example.test/theirs" }],
		description: "advisory description",
		published_at: "2026-02-02",
		ghsa_id: "GHSA-theirs",
		cve_id: "CVE-theirs",
	});
	assert.equal(merged.title, "advisory title");
	assert.equal(merged.severity, "critical");
	assert.equal(merged.ghsaId, "GHSA-theirs");
	assert.equal(merged.cveId, "CVE-theirs");
	assert.equal(merged.publishedAt, "2026-02-02");
	assert.deepEqual(merged.cwes, [{ id: "CWE-89", name: "SQL injection", description: undefined }]);
	assert.deepEqual(merged.references, [{ url: "https://example.test/theirs" }]);
});

test("the advisory severity always wins, whatever the alert carried", () => {
	// Unlike the identifiers, which keep the finding's own value, severity is an
	// unconditional override: the global advisory is the authority on severity.
	const merged = mergeAdvisory({ severity: "low", cwes: [], references: [] }, { severity: "high" });
	assert.equal(merged.severity, "high");
});

test("a finding counts as an advisory only with a package and an id", () => {
	assert.equal(isAdvisory({ source: "dependabot" }), true);
	assert.equal(
		isAdvisory({ source: "code-scanning", packageName: "vite", ghsaId: "GHSA-a" }),
		true,
	);
	assert.equal(
		isAdvisory({ source: "code-scanning", packageName: "vite", cveId: "CVE-1" }),
		true,
	);
	assert.equal(isAdvisory({ source: "code-scanning", packageName: "vite" }), false);
	assert.equal(isAdvisory({ source: "code-scanning", ghsaId: "GHSA-a" }), false);
});
