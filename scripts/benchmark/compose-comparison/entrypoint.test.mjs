// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ENTRYPOINT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../compose-comparison.mjs",
);

test("entrypoint re-exports the module surface existing callers use", async () => {
	const entrypoint = await import(ENTRYPOINT);
	for (const name of [
		"STACKS",
		"calculateStats",
		"pollUrls",
		"waitForPortsFree",
		"getEnvironmentInfo",
		"runTrial",
		"stopStack",
		"formatMarkdownReport",
	]) {
		assert.ok(entrypoint[name] !== undefined, `missing re-export ${name}`);
	}
});

test("entrypoint stays a thin orchestrator under 250 lines", () => {
	const lineCount = readFileSync(ENTRYPOINT, "utf8").split("\n").length;
	assert.ok(
		lineCount <= 250,
		`entrypoint grew to ${lineCount} lines; move logic into compose-comparison/ modules`,
	);
});
