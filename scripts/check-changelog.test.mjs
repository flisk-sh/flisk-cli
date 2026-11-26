// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HEADING, problems } from "./check-changelog.mjs";

test("HEADING accepts a version heading, Unreleased and Earlier", () => {
	for (const good of ["## 1.4.67 (2026-11-16)", "## 1.4.66-rc.1 (2026-11-15)", "## Unreleased", "## Earlier"])
		assert.ok(HEADING.test(good), good);
});

test("problems flags a malformed or (undefined) heading", () => {
	const changelog = [
		"# Changelog",
		"",
		"## Unreleased",
		"",
		"## 2026-11-16 (undefined)",
		"",
		"- a bullet",
		"## 1.4.65 (2026-11-15)",
		"",
		"## (2026-11-15)",
		"## 1.4.64 2026-11-14",
		"### not a section heading",
	].join("\n");
	const found = problems(changelog);
	assert.equal(found.length, 3);
	assert.match(found[0], /line 5/);
	assert.match(found[1], /line 10/);
	assert.match(found[2], /line 11/);
});

test("this repo's docs/CHANGELOG.md passes", () => {
	const changelog = readFileSync(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
	assert.deepEqual(problems(changelog), []);
});
