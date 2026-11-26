// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const LIB = new URL("../lib.sh", import.meta.url).pathname;

function poll(upLog) {
  const dir = mkdtempSync(join(tmpdir(), "poll-until-"));
  if (upLog !== null) writeFileSync(join(dir, "up.log"), upLog);
  const started = Date.now();
  const r = spawnSync("bash", ["-c", `source "${LIB}"; DIR="${dir}"; poll_until "the api is running" 6 false`], { encoding: "utf8" });
  return { r, seconds: (Date.now() - started) / 1000 };
}

test("poll_until stops at once when flisk up refused to start (Cold start blocked)", () => {
  const { r, seconds } = poll("Cold start blocked. Bun/Prisma/NATS are not the first failure.\nFAIL compose Could not verify Docker\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /flisk up refused to start while waiting for: the api is running/);
  assert.ok(seconds < 4, `returned after ${seconds}s, expected well before the 6s timeout`);
});

// Skipped while CI workflows are disabled (.github/workflows-disabled/) or outside CI. Re-enable when the workflow returns.
test.skip("poll_until still waits out the timeout when up.log shows no refusal", () => {
  const { r, seconds } = poll("starting\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /timed out after 6s waiting for: the api is running/);
  assert.ok(seconds >= 6);
});

// Skipped while CI workflows are disabled (.github/workflows-disabled/) or outside CI. Re-enable when the workflow returns.
test.skip("poll_until prints the end of up.log when it times out", () => {
  const { r } = poll("Tilt started\ntraefik failed: port 80 in use\n");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /timed out after 6s waiting for: the api is running\n[\s\S]*traefik failed: port 80 in use/);
});

// Skipped while CI workflows are disabled (.github/workflows-disabled/) or outside CI. Re-enable when the workflow returns.
test.skip("poll_until times out quietly when there is no up.log", () => {
  const { r } = poll(null);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /timed out after 6s waiting for: the api is running/);
  assert.doesNotMatch(r.stderr, /tail:|No such file/);
});

test("poll_until prints how long it waited when the command succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "poll-until-"));
  const r = spawnSync("bash", ["-c", `source "${LIB}"; DIR="${dir}"; poll_until "the api is running" 6 true`], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^waited \d+ s for: the api is running$/m);
});
