// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for scripts/security-alert-issues/versions.mjs.
//   node --test scripts/security-alert-issues/versions.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assessPinnedVersion,
	compareVersions,
	parseVersion,
	parseVersionRange,
	versionInRange,
} from "./versions.mjs";

test("a version parses into numbers and a pre-release suffix", () => {
	assert.deepEqual(parseVersion("1.2.3"), { numbers: [1, 2, 3], suffix: "" });
	assert.deepEqual(parseVersion("v1.2.3"), { numbers: [1, 2, 3], suffix: "" });
	assert.deepEqual(parseVersion(" 1.2.3-beta.1 "), { numbers: [1, 2, 3], suffix: "beta.1" });
	assert.deepEqual(parseVersion("1.0"), { numbers: [1, 0], suffix: "" });
	assert.equal(parseVersion("latest"), null);
	assert.equal(parseVersion(""), null);
	assert.equal(parseVersion(null), null);
	assert.equal(parseVersion(undefined), null);
});

test("versions compare numerically, not lexically", () => {
	assert.equal(compareVersions("2.0", "1.9"), 1);
	assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
	assert.equal(compareVersions("0.0.1", "0.0.10"), -1);
	assert.equal(compareVersions("v2.0.0", "2.0.0"), 0);
});

test("a pre-release is older than the release it leads to", () => {
	assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
	assert.equal(compareVersions("1.0.0", "1.0.0-alpha"), 1);
	assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
	assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha"), 0);
	// The separator between the numbers and the suffix does not matter.
	assert.equal(compareVersions("1.0.0.rc1", "1.0.0-rc1"), 0);
});

test("an unreadable version cannot be compared", () => {
	assert.equal(compareVersions("latest", "1.0.0"), null);
	assert.equal(compareVersions("1.0.0", "latest"), null);
	assert.equal(compareVersions(null, null), null);
});

test("a range parses one version, one operator and constraints joined by comma or space", () => {
	assert.deepEqual(parseVersionRange("1.2.3"), [[{ op: "==", version: "1.2.3" }]]);
	assert.deepEqual(parseVersionRange("=1.2.3"), [[{ op: "=", version: "1.2.3" }]]);
	assert.deepEqual(parseVersionRange(">= 1.0.0, < 2.0.0"), [
		[
			{ op: ">=", version: "1.0.0" },
			{ op: "<", version: "2.0.0" },
		],
	]);
	// Spaces work where a comma would.
	assert.deepEqual(parseVersionRange(">=1.0.0 <2.0.0"), [
		[
			{ op: ">=", version: "1.0.0" },
			{ op: "<", version: "2.0.0" },
		],
	]);
	assert.deepEqual(parseVersionRange("!=1.5.0"), [[{ op: "!=", version: "1.5.0" }]]);
});

test("caret and tilde ranges expand to their two bounds", () => {
	assert.deepEqual(parseVersionRange("^1.2.3"), [
		[
			{ op: ">=", version: "1.2.3" },
			{ op: "<", version: "2.0.0" },
		],
	]);
	// A zero major keeps the minor fixed.
	assert.deepEqual(parseVersionRange("^0.2.3"), [
		[
			{ op: ">=", version: "0.2.3" },
			{ op: "<", version: "0.3.0" },
		],
	]);
	assert.deepEqual(parseVersionRange("^0.0.3"), [
		[
			{ op: ">=", version: "0.0.3" },
			{ op: "<", version: "0.0.4" },
		],
	]);
	assert.deepEqual(parseVersionRange("~1.2.3"), [
		[
			{ op: ">=", version: "1.2.3" },
			{ op: "<", version: "1.3.0" },
		],
	]);
	assert.deepEqual(parseVersionRange("~1"), [
		[
			{ op: ">=", version: "1" },
			{ op: "<", version: "2" },
		],
	]);
	// A two-component tilde keeps its own bounds: `~1.2` allows everything below
	// 2.0 here, while npm semver reads `~1.2` as `>=1.2.0 <1.3.0`. Current
	// behaviour, pinned; the one- and three-component forms match npm.
	assert.deepEqual(parseVersionRange("~1.2"), [
		[
			{ op: ">=", version: "1.2" },
			{ op: "<", version: "2.0" },
		],
	]);
	assert.equal(versionInRange("1.9.0", "~1.2"), true);
});

test("a range with alternatives parses each one", () => {
	const parsed = parseVersionRange("1.0.0 || >= 2.0.0, < 3.0.0");
	assert.equal(parsed.length, 2);
	assert.deepEqual(parsed[0], [{ op: "==", version: "1.0.0" }]);
	assert.deepEqual(parsed[1], [
		{ op: ">=", version: "2.0.0" },
		{ op: "<", version: "3.0.0" },
	]);
});

test("a range that cannot be read is null", () => {
	for (const bad of ["", " ", "latest", "1.x", "1.0.*", "*", ">=", "1.0.0 ||", "not a range"]) {
		assert.equal(parseVersionRange(bad), null, `range: ${JSON.stringify(bad)}`);
	}
	assert.equal(parseVersionRange(null), null);
	assert.equal(parseVersionRange(undefined), null);
});

test("a version is checked against every constraint of an alternative", () => {
	assert.equal(versionInRange("1.5.0", ">= 1.0.0, < 2.0.0"), true);
	assert.equal(versionInRange("2.0.0", ">= 1.0.0, < 2.0.0"), false);
	assert.equal(versionInRange("1.0.0", "!= 1.0.0"), false);
	assert.equal(versionInRange("1.0.1", "!= 1.0.0"), true);
	assert.equal(versionInRange("2.0.0", "> 1.0.0"), true);
	assert.equal(versionInRange("1.0.0", "> 1.0.0"), false);
	// One matching alternative is enough.
	assert.equal(versionInRange("2.5.0", "1.0.0 || >= 2.0.0, < 3.0.0"), true);
	assert.equal(versionInRange("3.0.0", "1.0.0 || >= 2.0.0, < 3.0.0"), false);
	// An unreadable version or range is null, not false.
	assert.equal(versionInRange("latest", ">= 1.0.0"), null);
	assert.equal(versionInRange("1.0.0", "not a range"), null);
});

test("the pinned version inside the vulnerable range is affected", () => {
	const assessment = assessPinnedVersion({
		pinned: { version: "1.5.0", range: null, kind: "pinned" },
		range: ">= 1.0.0, < 2.0.0",
	});
	assert.equal(assessment.status, "affected");
	assert.equal(assessment.reason, "it is inside the vulnerable range");
});

test("the pinned version outside the vulnerable range is not affected", () => {
	const assessment = assessPinnedVersion({
		pinned: { version: "2.5.0", range: null, kind: "pinned" },
		range: ">= 1.0.0, < 2.0.0",
	});
	assert.equal(assessment.status, "not-affected");
	assert.equal(assessment.reason, "it is outside the vulnerable range");
});

test("the fixed version answers when the range cannot be read", () => {
	assert.equal(
		assessPinnedVersion({
			pinned: { version: "1.0.0", kind: "pinned" },
			patched: "1.0.0",
		}).status,
		"not-affected",
	);
	assert.equal(
		assessPinnedVersion({
			pinned: { version: "1.0.1", kind: "pinned" },
			patched: "1.0.0",
		}).status,
		"not-affected",
	);
	assert.equal(
		assessPinnedVersion({
			pinned: { version: "0.9.9", kind: "pinned" },
			patched: "1.0.0",
		}).status,
		"affected",
	);
});

test("no version, or nothing to compare it with, leaves the judgement open", () => {
	const noVersion = assessPinnedVersion({
		pinned: { version: null, range: "^1.0.0", kind: "range" },
		reason: "the manifest pins a range (`^1.0.0`), not one version",
	});
	assert.equal(noVersion.status, "unknown");
	assert.equal(noVersion.reason, "the manifest pins a range (`^1.0.0`), not one version");
	const defaultReason = assessPinnedVersion({ pinned: null });
	assert.equal(defaultReason.status, "unknown");
	assert.equal(defaultReason.reason, "the manifest carries no version for this package");
	const noComparison = assessPinnedVersion({
		pinned: { version: "1.0.0", kind: "pinned" },
	});
	assert.equal(noComparison.status, "unknown");
	assert.equal(noComparison.verdict, "The pinned version could not be compared");
});
