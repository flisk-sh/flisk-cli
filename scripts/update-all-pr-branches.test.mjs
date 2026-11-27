// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflowPath = new URL("../.github/workflows-disabled/update-all-pr-branches.yml", import.meta.url);
const workflow = parse(readFileSync(workflowPath, "utf8"));
const step = workflow.jobs["update-all"].steps[0];

function run(input, outcomes = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flisk-selected-prs-"));
  try {
    writeFileSync(join(dir, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "pr" && args[1] === "list") {
  console.log("11\\n22\\n33");
} else if (args[0] === "api" && args[1] === "--method" && args[2] === "PUT") {
  const number = args[3].split("/")[4];
  const outcome = JSON.parse(process.env.GH_OUTCOMES)[number];
  if (outcome) { console.error(outcome); process.exit(1); }
} else { process.exit(2); }
`, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "acme/flisk",
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
      GH_LOG: join(dir, "calls"),
      GH_OUTCOMES: JSON.stringify(outcomes),
    };
    delete env.PR_NUMBERS;
    if (input !== undefined) env.PR_NUMBERS = input;
    const result = spawnSync("bash", ["-c", step.run], {
      cwd: dir, env, encoding: "utf8", timeout: 10_000,
    });
    const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
    return {
      ...result,
      calls: read("calls").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
      summary: read("summary"),
      injected: existsSync(join(dir, "injected")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("requires explicit selection through env and leaves the workflow parked", () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.pr_numbers.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.pr_numbers.type, "string");
  assert.equal(step.env.PR_NUMBERS, "${{ inputs.pr_numbers }}");
  assert.ok(!step.run.includes("${{"), "untrusted inputs must not be interpolated into shell");
  assert.ok(!existsSync(new URL("../.github/workflows/update-all-pr-branches.yml", import.meta.url)));
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs["update-all"].permissions, { "pull-requests": "write" });
});

test("updates only the selected PRs, in order, without discovering open PRs", () => {
  const r = run("22 11");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [22, 11].map((n) =>
    ["api", "--method", "PUT", `repos/acme/flisk/pulls/${n}/update-branch`]));
  assert.match(r.summary, /Updated: #22 #11/);
  assert.ok(!r.summary.includes("#33"));
});

test("accepts one PR and surrounding or repeated spaces, updating duplicates once", () => {
  for (const input of ["22", "  22 22   22  "]) {
    const r = run(input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.calls.length, 1);
    assert.match(r.calls[0][3], /\/22\/update-branch$/);
  }
});

for (const input of [undefined, "", "   ", "0", "-1", "01", "#22", "11,22", "11 nope",
  "11\n22", "11\t22", "11; touch injected", "11 $(touch injected)", "11 `touch injected`",
  '11 "22"', "11 *", "11 ../../issues/22", "11 22\r"]) {
  test(`rejects invalid selection ${JSON.stringify(input)} before any API call`, () => {
    const r = run(input);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /space-separated positive PR numbers/);
    assert.deepEqual(r.calls, []);
    assert.equal(r.injected, false);
  });
}

test("preserves conflict and skip summaries and continues with selected PRs", () => {
  const r = run("11 22 33", { 11: "Merge conflict", 22: "No permission" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.length, 3);
  assert.match(r.summary, /Updated: #33/);
  assert.match(r.summary, /Merge conflict \(needs a human\): #11/);
  assert.match(r.summary, /Skipped \(already current or no permission\): #22/);
});
