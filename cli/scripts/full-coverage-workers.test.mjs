// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The private Linux runner exposes two CPUs. Vitest's default reserves one, serializing full coverage past the job limit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const job = workflow.jobs.test;
const fullCoverage = job.steps.find(
  (step) => step.name === "Run TypeScript unit tests with coverage",
);
const cli = JSON.parse(readFileSync(new URL("../../cli/package.json", import.meta.url), "utf8"));

test("full coverage uses both private-runner CPUs without changing the fork pool or isolating fewer tests", () => {
  assert.equal(fullCoverage.run, "bun run test:coverage --maxWorkers=2");
  assert.equal(fullCoverage.env.FLISK_REQUIRE_TILT, "1");
});

test("full coverage keeps the existing suite, reports and 57-percent floor", () => {
  assert.match(cli.scripts["test:coverage"], /^vitest run --coverage /);
  for (const flag of [
    "--coverage.thresholds.lines=57",
    "--coverage.reporter=json-summary",
    "--coverage.reporter=json",
    "--reporter=json",
    "--outputFile.json=test-results/vitest.json",
  ]) {
    assert.ok(cli.scripts["test:coverage"].includes(flag), flag);
  }
  assert.doesNotMatch(
    cli.scripts["test:coverage"],
    /--(?:exclude|shard|testNamePattern|passWithNoTests)/,
  );
});

test("full coverage keeps the ratchet, ten-minute hang guard and required Summary dependency", () => {
  assert.equal(job["timeout-minutes"], 10);
  const ratchet = job.steps.find((step) => step.name === "Coverage ratchet for high-risk areas");
  assert.ok(ratchet, "the per-area ratchet must still run");
  assert.equal(ratchet.if, `\${{ !cancelled() && steps.select.outputs.mode != 'selected' }}`);
  assert.equal(
    ratchet.run,
    "node scripts/coverage-ratchet.mjs --json test-results/coverage-ratchet.json",
  );
  assert.ok(workflow.jobs.summary.needs.includes("test"));
});

test("the worker-count fix neither expands permissions nor changes which events run full coverage", () => {
  assert.deepEqual(job.permissions, { contents: "write", "pull-requests": "write" });
  assert.equal(fullCoverage.if, `\${{ steps.select.outputs.mode != 'selected' }}`);
  assert.equal(fullCoverage["working-directory"], "cli");
});
