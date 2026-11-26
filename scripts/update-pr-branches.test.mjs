// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "update-pr-branches.sh");

// Fake `gh`: logs every call to $GH_LOG, then answers by endpoint key.
//   <key>.fail holding N  -> the next N calls fail with the live workflow's GraphQL 502
//   <key>.err             -> printed to stderr, exits 1 (a non-5xx failure)
//   <key>.seq             -> one response per line, consumed call by call
//   <key>                 -> printed verbatim
// Keys: "list", "view-<number>", "put-<number>".
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
key=""
case "$*" in
  "pr list"*) key="list" ;;
  "pr view "*) key="view-$3" ;;
  *update-branch*) key="put-$(printf '%s' "$4" | sed -E 's|.*/pulls/([0-9]+)/.*|\\1|')" ;;
esac
f="$GH_CASE/$key.fail"
if [ -f "$f" ]; then
  n=$(cat "$f")
  if [ "$n" -gt 0 ]; then
    echo $((n - 1)) > "$f"
    echo "HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)" >&2
    exit 1
  fi
fi
e="$GH_CASE/$key.err"
if [ -f "$e" ]; then
  cat "$e" >&2
  exit 1
fi
s="$GH_CASE/$key.seq"
if [ -f "$s" ]; then
  head -n 1 "$s"
  tail -n +2 "$s" > "$s.tmp" && mv "$s.tmp" "$s"
  exit 0
fi
cat "$GH_CASE/$key"
`;

function run({ files = {}, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flisk-upb-"));
  try {
    const bin = join(dir, "bin");
    const cases = join(dir, "case");
    mkdirSync(bin);
    mkdirSync(cases);
    writeFileSync(join(bin, "gh"), GH_STUB, { mode: 0o755 });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(cases, name), content);
    }
    const result = spawnSync("bash", [SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_LOG: join(dir, "gh.log"),
        GH_CASE: cases,
        UPB_DELAY: "0",
        GITHUB_REPOSITORY: "acme/flisk",
        EVENT_NAME: "push",
        PR_NUMBER: "",
        BASE_BRANCH: "",
        ...env,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    const log = existsSync(join(dir, "gh.log")) ? readFileSync(join(dir, "gh.log"), "utf8") : "";
    return { ...result, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const calls = (log, prefix) => log.split("\n").filter((line) => line.startsWith(prefix));

test("lists candidates without mergeStateStatus and updates a BEHIND PR", () => {
  const r = run({
    files: { list: "101\n", "view-101": "main\tBEHIND\tabc123\n", "put-101": "" },
  });
  assert.equal(r.status, 0, r.stderr);
  const [list] = calls(r.log, "pr list");
  assert.ok(list.includes("reviewDecision,autoMergeRequest"));
  assert.ok(!list.includes("mergeStateStatus"));
  assert.match(
    r.log,
    /--method PUT repos\/acme\/flisk\/pulls\/101\/update-branch -f expected_head_sha=abc123/,
  );
});

test("retries a single GraphQL 502 on a per-PR state read", () => {
  const r = run({
    files: {
      list: "102\n",
      "view-102.fail": "1",
      "view-102": "main\tBEHIND\tdef456\n",
      "put-102": "",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr view 102").length, 2);
  assert.match(r.stderr, /GitHub API retry/);
  assert.match(r.log, /pulls\/102\/update-branch -f expected_head_sha=def456/);
});

test("a PR that keeps 5xx-ing is skipped and later PRs still update", () => {
  const r = run({
    files: {
      list: "103\n104\n",
      "view-103.fail": "9",
      "view-104": "main\tBEHIND\tbbb\n",
      "put-104": "",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr view 103").length, 3); // GH_ATTEMPTS
  assert.match(r.stdout, /PR #103 state could not be read/);
  assert.ok(!r.log.includes("pulls/103/update-branch"));
  assert.match(r.log, /pulls\/104\/update-branch -f expected_head_sha=bbb/);
});

test("a single 502 on the list call is retried", () => {
  const r = run({
    files: { "list.fail": "1", list: "105\n", "view-105": "main\tCLEAN\tccc\n" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr list").length, 2);
  assert.ok(!r.log.includes("update-branch")); // CLEAN state needs no update
});

test("a persistent list failure warns and exits green without reading PRs", () => {
  const r = run({ files: { "list.fail": "9" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr list").length, 3);
  assert.equal(calls(r.log, "pr view").length, 0);
  assert.match(r.stdout, /Could not list open PRs/);
});

test("a non-5xx failure is not retried", () => {
  const r = run({
    files: { list: "106\n", "view-106.err": "HTTP 403: Forbidden\n" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr view 106").length, 1);
  assert.match(r.stdout, /PR #106 state could not be read/);
});

test("pull_request_target updates only the named PR", () => {
  const r = run({
    env: { EVENT_NAME: "pull_request_target", PR_NUMBER: "107", BASE_BRANCH: "main" },
    files: { "view-107": "main\tBEHIND\txyz\n", "put-107": "" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr list").length, 0);
  assert.match(r.log, /pulls\/107\/update-branch -f expected_head_sha=xyz/);
});

test("pull_request_target on a non-main base skips without any gh call", () => {
  const r = run({
    env: { EVENT_NAME: "pull_request_target", PR_NUMBER: "108", BASE_BRANCH: "dev" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.log, "");
});

test("an UNKNOWN merge state is polled until it resolves", () => {
  const r = run({
    files: {
      list: "109\n",
      "view-109.seq": "main\tUNKNOWN\ts1\nmain\tBEHIND\ts2\n",
      "put-109": "",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls(r.log, "pr view 109").length, 2);
  assert.match(r.log, /pulls\/109\/update-branch -f expected_head_sha=s2/);
});
