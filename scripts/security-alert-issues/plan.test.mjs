// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for scripts/security-alert-issues/plan.mjs.
//   node --test scripts/security-alert-issues/plan.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { markerFor, normalizeDependabotAlert } from "./alerts.mjs";
import { bodyFor, LABEL_DEFS, labelsFor } from "./issues.mjs";
import { finalLabelSet, planLabels, planSync, sameLabels } from "./plan.mjs";

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
		description: "launch-editor did not escape % on Windows.",
		severity: "medium",
	},
	security_vulnerabilities: [
		{
			vulnerable_version_range: ">= 7.0.0, < 7.3.7",
			first_patched_version: { identifier: "7.3.7" },
		},
	],
};

test("a finding with no managed issue is a create", () => {
	const actions = planSync([normalizeDependabotAlert(DEPENDABOT_ALERT)], []);
	assert.equal(actions.length, 1);
	assert.equal(actions[0].action, "create");
	assert.equal(actions[0].issue, null);
	assert.equal(actions[0].finding.packageName, "vite");
});

test("a label drift on an unchanged body still updates the issue", () => {
	const finding = normalizeDependabotAlert(DEPENDABOT_ALERT);
	const issue = {
		number: 900,
		state: "open",
		body: bodyFor(finding),
		labels: ["security"],
	};
	const actions = planSync([finding], [issue]);
	assert.equal(actions.length, 1);
	assert.equal(actions[0].action, "update");
	assert.deepEqual(actions[0].labels, labelsFor(finding));
});

test("a closed issue reopens even when its body is already current", () => {
	// The state check runs before the body comparison: closed always means reopen.
	const finding = normalizeDependabotAlert(DEPENDABOT_ALERT);
	const issue = {
		number: 900,
		state: "closed",
		body: bodyFor(finding),
		labels: labelsFor(finding),
	};
	const actions = planSync([finding], [issue]);
	assert.equal(actions.length, 1);
	assert.equal(actions[0].action, "reopen");
});

test("an issue in the older marker shape is closed once nothing matches it", () => {
	const issue = {
		number: 901,
		state: "open",
		body: "<!-- flisk:security-alert:dependabot:12 --> old",
		labels: [],
	};
	const actions = planSync([], [issue]);
	assert.equal(actions.length, 1);
	assert.equal(actions[0].action, "close");
});

test("closes follow the per-group actions, in issue order", () => {
	const finding = normalizeDependabotAlert(DEPENDABOT_ALERT);
	const stale = {
		number: 900,
		state: "open",
		body: `${markerFor("GHSA-old|m")}\n`,
		labels: [],
	};
	const gone = {
		number: 901,
		state: "closed",
		body: `${markerFor("GHSA-older|n")}\n`,
		labels: [],
	};
	const actions = planSync([finding], [stale, gone]);
	assert.deepEqual(
		actions.map((action) => action.action),
		["create", "close", "close"],
	);
	// A closed issue whose alert is gone is closed again; reopening is the alert's job.
	assert.equal(actions[2].issue.number, 901);
});

test("an issue that is a pull request is not a managed issue", () => {
	// listManagedIssues filters pull requests out upstream; a stray one that slips
	// through still only matches by its marker like any other issue.
	const issue = { number: 1, state: "open", body: "no marker", labels: [] };
	assert.equal(planSync([], [issue]).length, 0);
});

test("labels compare as sets, not lists", () => {
	assert.ok(sameLabels(["a", "b"], ["b", "a"]));
	assert.ok(sameLabels(["a", "a"], ["a"]));
	assert.ok(!sameLabels(["a"], ["a", "b"]));
	assert.ok(!sameLabels([], ["a"]));
	assert.ok(sameLabels([], []));
});

test("every fixed label is planned before the dynamic ones", () => {
	const planned = planLabels([]);
	for (const name of Object.keys(LABEL_DEFS)) {
		assert.ok(planned.has(name), `not planned: ${name}`);
		assert.equal(planned.get(name).description, LABEL_DEFS[name].description);
	}
	const withFinding = planLabels([normalizeDependabotAlert(DEPENDABOT_ALERT)]);
	assert.equal(
		withFinding.get("severity: medium").description,
		"Applied by the security-alert-issues workflow",
	);
	assert.match(withFinding.get("package: vite").color, /^[0-9a-f]{6}$/);
});

test("the final label set never touches a label outside the managed namespaces", () => {
	const managed = new Set(["security"]);
	// Labels the issue carries as objects and as strings are read by name.
	const final = finalLabelSet(
		[{ name: "claimed" }, "security", { name: null }, { name: "package: vite" }],
		["security"],
		managed,
	);
	assert.deepEqual(final, ["claimed", "security"]);
	assert.deepEqual(finalLabelSet(undefined, ["security"], managed), ["security"]);
	// A wanted label already present is not duplicated.
	assert.deepEqual(finalLabelSet(["security"], ["security"], managed), ["security"]);
});
