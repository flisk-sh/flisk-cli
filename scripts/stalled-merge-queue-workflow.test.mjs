// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("stalled merge queue runs the script from the selected reusable workflow commit", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows-disabled/stalled-merge-queue.yml", import.meta.url),
    "utf8",
  );
  const workflowRefs = [...workflow.matchAll(
    /^\s+uses:\s+flisk-sh\/\.github\/\.github\/workflows\/stalled-merge-queue\.yml@([0-9a-f]{40})(?:\s|$)/gm,
  )];
  const scriptRefs = [...workflow.matchAll(
    /^\s+scripts_ref:\s+([0-9a-f]{40})(?:\s|$)/gm,
  )];
  assert.equal(workflowRefs.length, 1, "expected one immutable reusable workflow ref");
  assert.equal(scriptRefs.length, 1, "expected one immutable script ref");
  assert.equal(
    scriptRefs[0][1],
    workflowRefs[0][1],
    "scripts_ref must match uses: so the script includes the workflow version's safety guards",
  );
});
