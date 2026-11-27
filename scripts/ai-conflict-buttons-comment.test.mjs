// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildComment } from "./ai-conflict-buttons.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "ai-conflict-buttons-comment.sh");

// Fake `gh`: logs every call, answers by argument shape, saves stdin of POST/PATCH.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$*" in
  *"--method POST"*|*"--method PATCH"*) cat > "$GH_STDIN" ;;
  *issues/comments/*)
    if [[ "\${GH_FAIL_COMMENT_READ:-}" == "true" ]]; then exit 1; fi
    printf '%s' "$GH_COMMENT_BODY" ;;
  *"--paginate"*) printf '%s' "\${GH_COMMENT_ID:-}" ;;
  *mergeable_state*) printf '%s\\n' "$GH_STATE" ;;
  *) printf '%s\\n' "$GH_PR_BODY" ;;
esac
`;

function run({ state = "dirty", commentId = "", commentBody = "", omit = [], extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flisk-conflict-comment-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), GH_STUB, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GH_LOG: join(dir, "gh.log"),
      GH_STDIN: join(dir, "gh-stdin.json"),
      GH_STATE: state,
      GH_COMMENT_ID: commentId,
      GH_COMMENT_BODY: commentBody,
      GH_PR_BODY: "Fixes #123",
      PR_NUMBER: "2365",
      PR_URL: "https://github.com/acme/flisk/pull/2365",
      HEAD_OWNER: "octocat",
      HEAD_BRANCH: "feature",
      BASE_BRANCH: "main",
      GITHUB_REPOSITORY: "acme/flisk",
      ...extra,
    };
    for (const key of omit) delete env[key];
    const result = spawnSync("bash", [SCRIPT], { cwd: ROOT, env, encoding: "utf8", timeout: 30_000 });
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
    return { ...result, log: read("gh.log"), posted: read("gh-stdin.json") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("posts the conflict comment for a conflicting PR", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /--method POST repos\/acme\/flisk\/issues\/2365\/comments/);
  const { body } = JSON.parse(r.posted);
  assert.ok(body.startsWith("<!-- ai-conflict-buttons -->"));
  assert.match(body, /This pull request conflicts with `main`\./);
  assert.match(body, /# Resolve this conflict in/);
  for (const link of ["https://grok.com/?q=", "https://claude.ai/new?q=", "https://chatgpt.com/?q="]) {
    assert.ok(body.includes(link), `missing button link ${link}`);
  }
  assert.match(body, /pull%2F2365/); // PR URL carried into the prompt
  assert.match(body, /Fixes%20%23123/); // closing issue carried into the prompt
});

test("exits non-zero when no PR number is given", () => {
  const r = run({ omit: ["PR_NUMBER"] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PR_NUMBER/);
  assert.equal(r.log, ""); // gh was never called
});

function currentComment(conflicting) {
  return buildComment({
    prUrl: "https://github.com/acme/flisk/pull/2365",
    prNumber: "2365",
    headOwner: "octocat",
    headBranch: "feature",
    baseBranch: "main",
    body: "Fixes #123",
    conflicting,
  });
}

for (const state of ["dirty", "clean"]) {
  test(`does not rewrite an unchanged ${state} comment`, () => {
    const r = run({ state, commentId: "42", commentBody: currentComment(state === "dirty") });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.log, /--method (POST|PATCH)/);
    assert.equal(r.posted, "");
    assert.match(r.stdout, /unchanged/);
  });
}

test("does not create a comment for a clean PR with no existing comment", () => {
  const r = run({ state: "clean" });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.log, /--method (POST|PATCH)/);
});

for (const [state, wasConflicting] of [["clean", true], ["dirty", false]]) {
  test(`updates the existing comment when state changes to ${state}`, () => {
    const r = run({ state, commentId: "42", commentBody: currentComment(wasConflicting) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.log, /--method PATCH repos\/acme\/flisk\/issues\/comments\/42/);
    assert.doesNotMatch(r.log, /--method POST/);
    assert.equal(JSON.parse(r.posted).body, currentComment(state === "dirty"));
  });
}

test("updates conflicting buttons when the prompt changes", () => {
  const r = run({
    commentId: "42",
    commentBody: currentComment(true),
    extra: { HEAD_BRANCH: "changed-branch" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /--method PATCH/);
  assert.match(JSON.parse(r.posted).body, /changed-branch/);
});


test("does not write when reading the existing comment fails", () => {
  const r = run({ commentId: "42", extra: { GH_FAIL_COMMENT_READ: "true" } });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.log, /--method (POST|PATCH)/);
});
