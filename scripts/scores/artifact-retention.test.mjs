// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for the artifact-retention scorer, on inline workflows and a small fixture repository.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { artifactKey, budgetOf, measure, uploadSteps } from "./artifact-retention.mjs";
import { writeFiles } from "./lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const WORKFLOW = `on: push
permissions: {}
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@abc # v7
        with:
          name: unit-test-results
          path: out/
          retention-days: 1
      - uses: actions/upload-artifact@abc # v7
        with:
          name: e2e-x-\${{ github.run_id }}
          path: out/
          retention-days: 31
      - uses: actions/upload-artifact@abc # v7
        with:
          name: unit-test-results
          path: out/
          retention-days: 14
      - uses: actions/upload-artifact@abc # v7
        with:
          name: report
          path: out/
      - uses: actions/upload-artifact@abc # v7
        with:
          name: sized
          path: out/
          retention-days: \${{ inputs.days }}
      - uses: actions/checkout@abc
`;

test("uploadSteps reads each step's name, retention and line", () => {
	const { steps } = uploadSteps(WORKFLOW);
	assert.deepEqual(
		steps.map(({ line, name, retention }) => ({ line, name, retention })),
		[
			{ line: 7, name: "unit-test-results", retention: "1" },
			{ line: 12, name: "e2e-x-${{ github.run_id }}", retention: "31" },
			{ line: 17, name: "unit-test-results", retention: "14" },
			{ line: 22, name: "report", retention: null },
			{ line: 26, name: "sized", retention: "${{ inputs.days }}" },
		],
	);
});

test("uploadSteps reads composite actions and reports YAML errors", () => {
	const action =
		"runs:\n  using: composite\n  steps:\n    - uses: actions/upload-artifact@abc\n      with:\n        name: evidence\n        retention-days: 7\n";
	assert.deepEqual(
		uploadSteps(action).steps.map((s) => [s.where, s.name, s.retention]),
		[["composite action", "evidence", "7"]],
	);
	assert.match(uploadSteps("jobs: [\n").error, /./);
});

test("artifactKey drops the expression suffix and budgetOf falls back to the default", () => {
	assert.equal(artifactKey("e2e-x-${{ github.run_id }}"), "e2e-x");
	assert.equal(artifactKey("unit-test-results"), "unit-test-results");
	assert.equal(budgetOf("unit-test-results"), 1);
	assert.equal(budgetOf("time-to-healthy-stack-${{ github.run_id }}"), 7);
	assert.equal(budgetOf("something-new"), 30);
});

test("measure counts unbounded and over-budget uploads across workflows and composite actions", () => {
	const root = mkdtempSync(path.join(tmpdir(), "artifact-retention-"));
	try {
		writeFiles(root, {
			".github/workflows/a.yml": WORKFLOW,
			".github/actions/post/action.yml":
				"runs:\n  using: composite\n  steps:\n    - uses: actions/upload-artifact@abc\n      with:\n        name: evidence\n",
		});
		const r = measure({ root });
		assert.equal(r.value, 4);
		assert.deepEqual(r.findings, [
			".github/workflows/a.yml:12 job test: upload-artifact e2e-x-${{ github.run_id }} keeps 31 days over its 30-day budget",
			".github/workflows/a.yml:17 job test: upload-artifact unit-test-results keeps 14 days over its 1-day budget",
			".github/workflows/a.yml:22 job test: upload-artifact report has no retention-days (the repository default applies)",
			".github/actions/post/action.yml:4 composite action: upload-artifact evidence has no retention-days (the repository default applies)",
		]);
		assert.equal(r.summary, "6 upload-artifact steps, 4 over budget or unbounded");
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("every upload-artifact step in this repository is inside its budget", () => {
	const r = measure({ root: repoRoot });
	assert.deepEqual(r.findings, []);
	assert.equal(r.value, 0);
});
