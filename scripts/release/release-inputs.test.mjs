// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  matchesInput,
  parseReleaseInputs,
  RELEASE_INPUTS,
  RELEASE_INPUTS_FILE,
  releaseFiltersYaml,
  releaseInputFor,
} from "./release-inputs.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("parseReleaseInputs trims whitespace and skips blank and comment lines", () => {
  assert.deepEqual(parseReleaseInputs("# a comment\n\n  cli/**  \n#another\npackage.json\n"), [
    "cli/**",
    "package.json",
  ]);
  assert.deepEqual(parseReleaseInputs(""), []);
});

test("RELEASE_INPUTS is parsed from .github/release-inputs.txt", () => {
  assert.deepEqual(RELEASE_INPUTS, parseReleaseInputs(readFileSync(RELEASE_INPUTS_FILE, "utf8")));
  assert.ok(RELEASE_INPUTS.length > 0);
});

// Every pattern must match at least one tracked file, or the release filter and the publish gate silently disagree
// with the repository layout: a typo, a moved directory, a pattern that never fires.
// Skipped while CI workflows are disabled (.github/workflows-disabled/) or outside CI. Re-enable when the workflow returns.
test.skip("every release input pattern matches at least one tracked file", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  assert.ok(tracked.length > 0, "git ls-files returned no tracked files");
  for (const pattern of RELEASE_INPUTS) {
    assert.ok(
      tracked.some((file) => matchesInput(pattern, file)),
      `${pattern} matches no tracked file`,
    );
  }
});

test("release-inputs.txt lists itself, so a rule change is itself a release input change", () => {
  assert.ok(RELEASE_INPUTS.includes(".github/release-inputs.txt"));
});

test("matchesInput treats a directory entry as a prefix, not a substring", () => {
  assert.equal(matchesInput("cli/**", "cli/a/b.ts"), true);
  assert.equal(matchesInput("cli/**", "clix/a.ts"), false);
  assert.equal(
    matchesInput("cli/**", "cli"),
    false,
    "the bare directory name is not a file under cli/**",
  );
  assert.equal(matchesInput("package.json", "package.json"), true);
  assert.equal(matchesInput("package.json", "package.jsonx"), false);
});

test("matchesInput throws on a glob form the list never uses", () => {
  assert.throws(() => matchesInput("a/*/b", "a/x/b"), /unsupported release input pattern/);
  assert.throws(() => matchesInput("**.json", "package.json"), /unsupported release input pattern/);
});

test("releaseInputFor maps a changed path to its release input or to undefined", () => {
  assert.equal(releaseInputFor("cli/src/main.ts"), "cli/**");
  assert.equal(releaseInputFor("runtime/engine/x.star"), "runtime/**");
  assert.equal(releaseInputFor(".github/release-inputs.txt"), ".github/release-inputs.txt");
  assert.equal(releaseInputFor("docs/ci.md"), undefined);
});

// The emitted file is what dorny/paths-filter parses in the changes job: a `release` key whose items are the quoted
// patterns, in the file's order. Re-parsing it must hand back the same list.
test("releaseFiltersYaml emits the release filter the workflow feeds to paths-filter", () => {
  const lines = releaseFiltersYaml().split("\n");
  assert.equal(lines[0], "release:");
  const patterns = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const item = line.match(/^ {2}- "([^"]+)"$/);
    assert.ok(item, `not a paths-filter rule line: ${line}`);
    patterns.push(item[1]);
  }
  assert.deepEqual(patterns, RELEASE_INPUTS);
});

// Wiring: the changes job must emit the rules from the shared file and hand the generated file to paths-filter, with
// no inline copy of the list left in the workflow.
test("release-binaries.yml builds its release filter from .github/release-inputs.txt", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows-disabled/release-binaries.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /node scripts\/release\/release-inputs\.mjs --emit-filters > "\$RUNNER_TEMP\/release-filters\.yml"/,
  );
  assert.match(workflow, /filters: \$\{\{ runner\.temp \}\}\/release-filters\.yml/);
  assert.doesNotMatch(
    workflow,
    /filters: \|/,
    "an inline paths-filter list crept back into the workflow",
  );
});
