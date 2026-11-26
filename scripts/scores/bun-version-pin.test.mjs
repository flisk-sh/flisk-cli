// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Unit tests for the Bun pin scorer: a fixture repository that follows the convention and the small ways a workflow can
// drift away from it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { measure, pinProblems } from "./bun-version-pin.mjs";

const ACTION = `name: Set up Bun
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@abc
      with:
        bun-version-file: .bun-version
`;
const WORKFLOW = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-bun
      - uses: oven-sh/setup-bun@abc
        with:
          bun-version-file: .bun-version
`;
const CANARY = `name: nightly
on: schedule
jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@abc
        with:
          bun-version: latest
`;
const SPARSE = (includePin) => `name: byo
on: workflow_call
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@abc
        with:
          path: flisk
          sparse-checkout: |
            scripts/e2e${includePin ? "\n            .bun-version" : ""}
      - uses: oven-sh/setup-bun@abc
        with:
          bun-version-file: flisk/.bun-version
`;

function fixture(files = {}) {
	const root = mkdtempSync(path.join(tmpdir(), "bun-version-pin-"));
	const texts = {
		".bun-version": "1.4.4\n",
		".github/actions/setup-bun/action.yml": ACTION,
		".github/workflows/ci.yml": WORKFLOW,
		".github/workflows/nightly-adopters.yml": CANARY,
		...files,
	};
	for (const [rel, text] of Object.entries(texts)) {
		const target = path.join(root, rel);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, text);
	}
	return root;
}

test("a fixture using the shared pin everywhere has no findings", () => {
	const root = fixture();
	try {
		assert.deepEqual(pinProblems(root), []);
		assert.equal(measure({ root }).value, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a sparse-checkout job must check out the pin it names", () => {
	const good = fixture({ ".github/workflows/ci.yml": SPARSE(true) });
	const bad = fixture({ ".github/workflows/ci.yml": SPARSE(false) });
	try {
		assert.deepEqual(pinProblems(good), []);
		assert.match(
			pinProblems(bad).join("\n"),
			/ci\.yml: job e2e step 2: flisk\/\.bun-version is not included in a sparse checkout/,
		);
	} finally {
		rmSync(good, { recursive: true, force: true });
		rmSync(bad, { recursive: true, force: true });
	}
});

test("measure passes on this repository", () => {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
	assert.deepEqual(measure({ root }).findings, []);
});

test("a missing or non-version pin file is a finding", () => {
	const missing = fixture();
	const unpinned = fixture({ ".bun-version": "latest\n" });
	try {
		rmSync(path.join(missing, ".bun-version"));
		assert.match(pinProblems(missing).join("\n"), /\.bun-version: missing shared Bun version file/);
		assert.match(pinProblems(unpinned).join("\n"), /\.bun-version: expected one Bun version/);
	} finally {
		rmSync(missing, { recursive: true, force: true });
		rmSync(unpinned, { recursive: true, force: true });
	}
});

test("the composite action must not repeat or override the pin", () => {
	const drifted = fixture({
		".github/actions/setup-bun/action.yml": `name: Set up Bun
inputs:
  bun-version:
    description: old override
    default: "1.4.4"
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@abc
      with:
        bun-version: \${{ inputs.bun-version }}
`,
	});
	try {
		const found = pinProblems(drifted).join("\n");
		assert.match(found, /setup-bun must read \.bun-version/);
		assert.match(found, /setup-bun must not override \.bun-version/);
		assert.match(found, /bun-version input duplicates \.bun-version/);
	} finally {
		rmSync(drifted, { recursive: true, force: true });
	}
});

test("workflows may not repeat the version; only nightly-adopters may use latest", () => {
	const drifted = fixture({
		".github/workflows/ci.yml": WORKFLOW.replace(
			"      - uses: ./.github/actions/setup-bun\n",
			'      - uses: ./.github/actions/setup-bun\n        with:\n          bun-version: "1.4.4"\n',
		),
		".github/workflows/other.yml": CANARY.replace("name: nightly", "name: other"),
	});
	try {
		const found = pinProblems(drifted).join("\n");
		assert.match(found, /ci\.yml: job test step 1: bun-version duplicates \.bun-version/);
		assert.match(found, /other\.yml: job canary step 1: bun-version duplicates \.bun-version/);
		assert.match(found, /direct setup-bun must read \.bun-version/);
	} finally {
		rmSync(drifted, { recursive: true, force: true });
	}
});
