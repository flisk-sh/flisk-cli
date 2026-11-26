// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";
import { CLI_PATH, REPO_ROOT } from "./paths.mjs";

test("REPO_ROOT resolves to the repository root", () => {
	assert.ok(existsSync(join(REPO_ROOT, "package.json")));
	assert.ok(existsSync(join(REPO_ROOT, "cli")));
});

test("CLI_PATH points at the compiled CLI entrypoint inside the repo", () => {
	assert.ok(CLI_PATH.endsWith(["cli", "dist", "cli.js"].join(sep)));
	assert.ok(CLI_PATH.startsWith(REPO_ROOT));
});
