// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { engineSourceFingerprint } from "../../cli/dist/generator/template-engine.js";
import { globToRegex } from "./lib.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = YAML.parse(
	fs.readFileSync(
		path.join(root, ".github/workflows-disabled/shop-bench.yml"),
		"utf8",
	),
);
const paths = workflow.on.pull_request.paths;
// GitHub evaluates paths in order; a later negative removes an earlier match.
// This workflow uses only literal paths, * and ** (the bench helper's glob subset).
function triggers(changed) {
	return changed.some((file) =>
		paths.reduce((matched, pattern) => {
			const negative = pattern.startsWith("!");
			return globToRegex(negative ? pattern.slice(1) : pattern).test(file)
				? !negative
				: matched;
		}, false),
	);
}

for (const file of [
	"runtime/engine/assets/docker/wake-gateway/decide.test.ts",
	"runtime/discovery/nested/future.test.ts",
	"runtime/engine/future.test.ts",
	"runtime/specs/future.test.ts",
	"runtime/ext/future.test.ts",
]) {
	test(`test-only change does not select the shop benchmark: ${file}`, () => {
		assert.equal(triggers([file]), false);
	});
}
for (const file of [
	"runtime/Tiltfile",
	"runtime/engine/assets/docker/wake-gateway/decide.ts",
	"runtime/discovery/loading.star",
	"runtime/specs/specs/TILT_TECH_STACK.star",
	"runtime/shared-platform-engineering/docker-templates/install-deps.sh",
	"runtime/ext/ide-components/shared/template_engine.py",
	"runtime/engine/docs/README.md",
	"runtime/discovery/test_resource_snapshot.py",
	"runtime/engine/topologies/tilt/manifest/tests/test_validator.star",
	"runtime/future-runtime-input.json",
	"runtime/future.test.ts",
	"runtime/shared-platform-engineering/docker-templates/future.test.ts",
	"cli/src/commands/up-steps.ts",
	"bench/shop/orders/src/index.ts",
	"scripts/bench/run.mjs",
	".github/workflows/shop-bench.yml",
]) {
	test(`needed input (including mixed test changes) still selects the benchmark: ${file}`, () => {
		assert.equal(triggers([file]), true);
		assert.equal(
			triggers([
				"runtime/engine/assets/docker/wake-gateway/decide.test.ts",
				file,
			]),
			true,
		);
	});
}
test("weekly/manual cadence, informational status and parked workflow remain unchanged", () => {
	assert.deepEqual(workflow.on.schedule, [{ cron: "17 3 * * 1" }]);
	assert.equal(workflow.on.workflow_dispatch.inputs.only.default, "");
	assert.match(workflow.jobs.measure.name, /informational/);
	assert.equal(
		fs.existsSync(path.join(root, ".github/workflows/shop-bench.yml")),
		false,
	);
	assert.equal(triggers(["docs/README.md"]), false);
});

test("the actual CLI excludes TypeScript unit tests from fingerprint and vendored assets, but retains docs and runtime code", (t) => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shop-bench-scope-"));
	t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
	const source = path.join(tmp, "source");
	const templates = path.join(tmp, "templates");
	fs.mkdirSync(templates, { recursive: true });
	const write = (rel, content) => {
		const file = path.join(source, "runtime", rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, content);
	};
	for (const dir of ["engine", "discovery", "specs", "ext"])
		fs.mkdirSync(path.join(source, "runtime", dir), { recursive: true });
	write("Tiltfile", "# fixture entrypoint\n");
	write("engine/decide.ts", "export const decide = true;\n");
	write("engine/decide.test.ts", "throw new Error('not a runtime input');\n");
	write("engine/docs/README.md", "Runtime documentation\n");
	const fingerprint = () => engineSourceFingerprint(source, templates);
	const before = fingerprint();
	write("engine/decide.test.ts", "throw new Error('changed test');\n");
	assert.equal(fingerprint(), before);
	write("engine/docs/README.md", "Changed runtime documentation\n");
	assert.notEqual(fingerprint(), before);
	const afterDocs = fingerprint();
	write("engine/decide.ts", "export const decide = false;\n");
	assert.notEqual(fingerprint(), afterDocs);

	const project = path.join(tmp, "shop");
	fs.mkdirSync(project);
	execFileSync(
		process.execPath,
		[
			path.join(root, "cli/bin/flisk.js"),
			"project",
			"--yes",
			"--no-agent-skills",
		],
		{
			cwd: project,
			env: {
				...process.env,
				FLISK_EXTENSION_SOURCE: source,
				FLISK_LICENSE_KEY: "",
				CI: "true",
				HOME: tmp,
			},
			timeout: 60000,
			stdio: "pipe",
		},
	);
	const vendored = path.join(project, ".flisk/.flisk-out/flisk-cli-ext/engine");
	assert.equal(fs.existsSync(path.join(vendored, "decide.test.ts")), false);
	assert.equal(
		fs.readFileSync(path.join(vendored, "decide.ts"), "utf8"),
		"export const decide = false;\n",
	);
	assert.equal(
		fs.readFileSync(path.join(vendored, "docs/README.md"), "utf8"),
		"Changed runtime documentation\n",
	);
});
