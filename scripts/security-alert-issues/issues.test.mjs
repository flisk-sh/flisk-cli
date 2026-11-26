// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for scripts/security-alert-issues/issues.mjs.
//   node --test scripts/security-alert-issues/issues.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { markerFor } from "./alerts.mjs";
import {
	affectedText,
	bodyFor,
	colorForLabel,
	isManagedLabel,
	isNotAffected,
	labelsFor,
	ledeFor,
	managedLabelSet,
	relatedFindings,
	sanitizeLabelPart,
	titleFor,
	truncate,
} from "./issues.mjs";

const FINDING = {
	key: "GHSA-698v-4r3x-3vcv|cli/pnpm-lock.yaml",
	source: "dependabot",
	alertNumber: 22,
	alertUrl: "https://github.com/flisk-sh/flisk/security/dependabot/22",
	title: "launch-editor: escapeCmdArgs() omits % escaping on Windows",
	severity: "medium",
	ghsaId: "GHSA-698v-4r3x-3vcv",
	cveId: "CVE-2026-112943",
	packageName: "vite",
	ecosystem: "npm",
	manifestPath: "cli/pnpm-lock.yaml",
	scope: "development",
	vulnerableRange: ">= 7.0.0, < 7.3.7",
	patchedVersion: "7.3.7",
	description: "launch-editor did not escape % on Windows.",
	cwes: [{ id: "CWE-77", name: "Command injection" }],
	references: [{ url: "https://example.test/advisory" }],
	publishedAt: "2026-10-20T18:30:00Z",
};

test("label parts keep only the characters GitHub allows", () => {
	assert.equal(sanitizeLabelPart("Vite"), "vite");
	assert.equal(sanitizeLabelPart("@scope/name"), "scope-name");
	assert.equal(sanitizeLabelPart("a b c"), "a-b-c");
	assert.equal(sanitizeLabelPart("--lead--trail--"), "lead--trail");
	assert.equal(sanitizeLabelPart("CWE-89"), "cwe-89");
	assert.equal(sanitizeLabelPart("!!!"), "");
	assert.equal(sanitizeLabelPart(0), "0");
});

test("a finding without package, ecosystem or scope asks for no dynamic labels", () => {
	const labels = labelsFor({ source: "code-scanning", severity: "high" });
	for (const prefix of ["package: ", "ecosystem: ", "scope: ", "cwe: "]) {
		assert.ok(
			!labels.some((label) => label.startsWith(prefix)),
			`unexpected ${prefix} label in ${labels}`,
		);
	}
	assert.ok(labels.includes("source: code-scanning"));
	assert.ok(labels.includes("severity: high"));
});

test("only the first three weaknesses become labels", () => {
	const labels = labelsFor({
		source: "dependabot",
		cwes: [
			{ id: "CWE-1" },
			{ id: "CWE-2" },
			{ id: "CWE-3" },
			{ id: "CWE-4" },
			{ id: "CWE-5" },
		],
	});
	for (const expected of ["cwe: 1", "cwe: 2", "cwe: 3"]) {
		assert.ok(labels.includes(expected), `missing label: ${expected}`);
	}
	assert.ok(!labels.includes("cwe: 4"));
	assert.ok(!labels.includes("cwe: 5"));
});

test("a label is managed by the exact set or by namespace", () => {
	const managed = new Set(["security"]);
	assert.equal(isManagedLabel("security", managed), true);
	assert.equal(isManagedLabel("severity: high", managed), true);
	assert.equal(isManagedLabel("source: dependabot", managed), true);
	// A lookalike that misses the namespace shape is not managed.
	assert.equal(isManagedLabel("severity:high", managed), false);
	assert.equal(isManagedLabel("severity", managed), false);
	assert.equal(isManagedLabel("claimed", managed), false);
	// Anything in a managed namespace is replaced on write, even a value nobody set.
	assert.equal(isManagedLabel("severity: bogus", managed), true);
});

test("the managed set always carries the fixed labels", () => {
	const managed = managedLabelSet([]);
	for (const label of [
		"security",
		"vulnerability",
		"security-alert",
		"auto-generated",
		"area: dependencies",
		"dependencies",
		"supply-chain",
		"help wanted",
		"not-affected",
		"windows",
	]) {
		assert.ok(managed.has(label), `not managed: ${label}`);
	}
});

test("the title collapses whitespace and drops the manifest parens when absent", () => {
	assert.equal(
		titleFor({ title: "a\n  multi\n   line", packageName: "vite" }),
		"[security] vite: a multi line",
	);
	assert.equal(titleFor({}), "[security] dependency: Dependency advisory");
	assert.equal(
		titleFor({ title: "t", packageName: "p", manifestPath: "m" }),
		"[security] p: t (m)",
	);
});

test("not-affected is read off the assessment, not the finding", () => {
	assert.equal(isNotAffected({ assessment: { status: "not-affected" } }), true);
	assert.equal(isNotAffected({ assessment: { status: "affected" } }), false);
	assert.equal(isNotAffected({}), false);
	assert.equal(isNotAffected({ assessment: null }), false);
});

test("the lede names the package, the manifest and the fix", () => {
	assert.equal(
		ledeFor(FINDING),
		"A published advisory affects **vite** as resolved in `cli/pnpm-lock.yaml`. The fix is 7.3.7.",
	);
	assert.equal(
		ledeFor({ packageName: "vite" }),
		"A published advisory affects **vite**. No patched version is published yet.",
	);
	// The not-affected lede says the pinned version is clear of the range.
	const clear = ledeFor({ ...FINDING, assessment: { status: "not-affected" } });
	assert.ok(clear.includes("is not in the affected range"));
	assert.ok(clear.includes("The fix is 7.3.7."));
});

test("the assessment text covers the unknown and the decided cases", () => {
	assert.equal(affectedText({}), "");
	const unknown = affectedText({
		packageName: "vite",
		manifestPath: "package.json",
		assessment: { status: "unknown", reason: "the manifest pins a range" },
	});
	assert.ok(unknown.includes("could not be read"));
	assert.ok(unknown.includes("judgement for a person"));
	const affected = affectedText({
		packageName: "vite",
		manifestPath: "requirements.txt",
		pinned: { version: "1.0.0" },
		patchedVersion: "1.0.1",
		assessment: { status: "affected", verdict: "The pinned version is affected", reason: "it is inside the vulnerable range" },
	});
	assert.ok(affected.includes("`requirements.txt` pins **vite 1.0.0**"));
	assert.ok(affected.includes("fixed in **1.0.1**"));
	const noFix = affectedText({
		packageName: "vite",
		pinned: { version: "1.0.0" },
		assessment: { status: "affected", verdict: "v", reason: "r" },
	});
	assert.ok(noFix.includes("the advisory lists no fixed version"));
});

test("findings are related by the shared advisory, not the key", () => {
	const other = { ...FINDING, key: "GHSA-698v-4r3x-3vcv|bun.lock", manifestPath: "bun.lock" };
	const unrelated = { key: "GHSA-x|m", ghsaId: "GHSA-x" };
	assert.deepEqual(relatedFindings(FINDING, [FINDING, other, unrelated]), [other]);
	// The CVE alone also relates two findings.
	const cveOnly = { key: "CVE-2026-112943|other", cveId: "CVE-2026-112943" };
	assert.deepEqual(relatedFindings({ ...FINDING, ghsaId: null }, [cveOnly]), [cveOnly]);
});

test("truncation keeps short text and marks what it cut", () => {
	assert.equal(truncate("short"), "short");
	assert.equal(truncate("x".repeat(20000)).length, 20000);
	const long = "y".repeat(20001);
	const cut = truncate(long);
	assert.ok(cut.length < 20100);
	assert.ok(cut.endsWith("_(truncated; read the full advisory at the link above)_"));
	assert.equal(truncate(long, 10), "yyyyyyyyyy\n\n_(truncated; read the full advisory at the link above)_");
});

test("the body renders a bare finding without optional sections", () => {
	const body = bodyFor({ key: "k|m", packageName: "vite", severity: "high" });
	assert.ok(body.startsWith("<!-- flisk:security-alert:k|m -->"));
	assert.ok(!body.includes("- GHSA:"));
	assert.ok(!body.includes("- CVE:"));
	assert.ok(!body.includes("- CVSS:"));
	assert.ok(!body.includes("- Published:"));
	assert.ok(!body.includes("- Alert:"));
	assert.ok(!body.includes("## Is this repository affected?"));
	assert.ok(!body.includes("## Weakness"));
	assert.ok(!body.includes("## Description"));
	assert.ok(!body.includes("## References"));
	assert.ok(!body.includes("## Also affected"));
	assert.ok(body.includes("| Package | `vite` |"));
	assert.ok(body.includes("No patched version"));
});

test("the body lists references given as strings or objects", () => {
	const body = bodyFor({
		...FINDING,
		references: ["https://example.test/a", { url: "https://example.test/b" }, { no: "url" }],
	});
	assert.ok(body.includes("- https://example.test/a"));
	assert.ok(body.includes("- https://example.test/b"));
});

test("the body carries the resolved version and the pinned version side by side", () => {
	const body = bodyFor({
		...FINDING,
		installedVersion: "8.3.1",
		pinned: { version: "8.3.1", kind: "pinned" },
	});
	assert.ok(body.includes("| Resolved version | `8.3.1` |"));
	assert.ok(body.includes("| Pinned version | `8.3.1` |"));
	assert.ok(body.includes("| Vulnerable range | `>= 7.0.0, < 7.3.7` |"));
	assert.ok(body.includes("| Scope | development |"));
});

test("a code-scanning source is dismissed without the dependabot reason", () => {
	const body = bodyFor({
		...FINDING,
		source: "code-scanning",
		assessment: { status: "not-affected" },
	});
	assert.ok(body.includes("dismisses the alert"));
	assert.ok(!body.includes("inaccurate"));
	const dependabotBody = bodyFor({ ...FINDING, assessment: { status: "not-affected" } });
	assert.ok(dependabotBody.includes("with the reason `inaccurate`"));
});

test("the severity label colours and the dynamic label fallbacks hold", () => {
	assert.equal(colorForLabel("severity: critical"), "b60205");
	assert.equal(colorForLabel("severity: low"), "0e8a16");
	assert.equal(colorForLabel("severity: unknown"), "fbca04");
	assert.equal(colorForLabel("source: code-scanning"), "8250df");
	assert.equal(colorForLabel("source: dependabot"), "0366d6");
	assert.equal(colorForLabel("scope: runtime"), "d93f0b");
	assert.equal(colorForLabel("scope: other"), "c2e0c6");
	assert.equal(colorForLabel("cwe: 89"), "5319e7");
	assert.equal(colorForLabel("package: vite"), "1d76db");
	assert.equal(colorForLabel("anything"), "1d76db");
});

test("the marker the body leads with is the one the sync reads back", () => {
	const body = bodyFor(FINDING);
	assert.ok(body.startsWith(markerFor(FINDING.key)));
});
