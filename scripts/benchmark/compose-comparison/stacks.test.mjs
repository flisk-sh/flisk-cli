// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { STACKS, writeStackFiles } from "./stacks.mjs";

test("registered STACKS contain demo, backend-postgres, and agent-stack", () => {
	assert.deepEqual(Object.keys(STACKS).sort(), [
		"agent-stack",
		"backend-postgres",
		"demo",
	]);
});

test("every stack carries probe metadata and a files map", () => {
	for (const [key, def] of Object.entries(STACKS)) {
		assert.ok(def.name, `Stack ${key} missing name`);
		assert.ok(def.description, `Stack ${key} missing description`);
		assert.ok(Array.isArray(def.urls), `Stack ${key} missing urls array`);
		assert.ok(def.urls.length >= 1, `Stack ${key} urls array is empty`);
		assert.ok(Array.isArray(def.ports), `Stack ${key} missing ports array`);
		assert.ok(def.ports.length >= 1, `Stack ${key} ports array is empty`);
		for (const u of def.urls) {
			assert.match(u, /^http:\/\/localhost:\d+\//);
			const port = Number(new URL(u).port);
			assert.ok(
				def.ports.includes(port),
				`Stack ${key} url ${u} port ${port} not in ports`,
			);
		}
		assert.equal(typeof def.files, "object", `Stack ${key} missing files map`);
		assert.ok(
			Object.keys(def.files).length > 0,
			`Stack ${key} files map is empty`,
		);
		for (const relativePath of Object.keys(def.files)) {
			assert.ok(
				!relativePath.startsWith("/") && !relativePath.includes(".."),
				`Stack ${key} file path ${relativePath} is not project-relative`,
			);
		}
	}
});

test("writeStackFiles materializes every fixture file under the target dir", () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-stack-test-"));
	try {
		writeStackFiles(dir, {
			"a/b/c.txt": "deep",
			"top.txt": "shallow",
		});
		assert.equal(readFileSync(join(dir, "a/b/c.txt"), "utf8"), "deep");
		assert.equal(readFileSync(join(dir, "top.txt"), "utf8"), "shallow");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const [key, def] of Object.entries(STACKS)) {
	test(`stack '${key}' setup writes a valid project into a temp dir`, () => {
		const dir = mkdtempSync(join(tmpdir(), `cc-stack-${key}-`));
		try {
			def.setup(dir);

			for (const [relativePath, content] of Object.entries(def.files)) {
				const target = join(dir, relativePath);
				assert.ok(existsSync(target), `${key}: missing ${relativePath}`);
				assert.equal(
					readFileSync(target, "utf8"),
					content,
					`${key}: content mismatch in ${relativePath}`,
				);
			}

			const project = JSON.parse(
				readFileSync(join(dir, ".flisk/project.json"), "utf8"),
			);
			assert.ok(project.project.name, `${key}: project.json missing name`);
			assert.deepEqual(project.discovery.paths, ["services/*/*"]);

			const compose = readFileSync(join(dir, "docker-compose.yml"), "utf8");
			assert.ok(
				compose.startsWith("services:"),
				`${key}: docker-compose.yml missing services`,
			);

			const serviceManifests = Object.keys(def.files).filter((p) =>
				p.endsWith("/service.json"),
			);
			assert.ok(
				serviceManifests.length >= 1,
				`${key}: expected at least one service.json`,
			);
			for (const manifestPath of serviceManifests) {
				const manifest = JSON.parse(
					readFileSync(join(dir, manifestPath), "utf8"),
				);
				assert.ok(manifest.appName, `${key}: ${manifestPath} missing appName`);
				assert.ok(manifest.appType, `${key}: ${manifestPath} missing appType`);
				assert.equal(manifest.schemaVersion, 1);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
