// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The file map test. Scaffolds a Docker-mode project with the real CLI (`flisk project`, `flisk resource`, `flisk config
// regenerate`) and compares every path Flisk wrote with tests/oracle/file-map.json: the plan of what Flisk creates, where, who owns
// it and whether a clone gets it. A new, missing or re-homed file fails with a plan-style diff. After a deliberate change:
//   FILE_MAP_UPDATE=1 node --test tests/oracle/__tests__/file-map.test.mjs
// which keeps each existing `owner` and `why` and asks you to fill them in for new entries.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildMap, collapse, diffMaps } from "../lib/file-map.mjs";
import { gitFiles, makeProjectDir, ownershipOf, runFlisk } from "../lib/surfaces.mjs";

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "file-map.json");
const OWNERS = ["generated", "scaffolded-once", "user-owned", "vendored"];

test("collapse folds vendored and per-service files into one entry", () => {
	assert.equal(collapse(".flisk/.flisk-out/flisk-cli-ext/engine/a.star"), ".flisk/.flisk-out/flisk-cli-ext/**");
	assert.equal(collapse(".agents/skills/flisk-up/SKILL.md"), ".agents/skills/<skill>/**");
	assert.equal(collapse("services/app/api/src/index.ts"), "services/<stack>/<service>/src/**");
	assert.equal(collapse("services/app/api/tsconfig.json"), "services/<stack>/<service>/tsconfig.json");
	assert.equal(collapse("services/platform/database-management/docker-compose.yml"), "services/platform/database-management/docker-compose.yml");
	assert.equal(collapse("AGENTS.md"), "AGENTS.md");
});

test("buildMap says tracked, ignored or mixed", () => {
	const map = buildMap({ tracked: ["a", "d/1"], all: ["a", "b", "d/1", "d/2"].map((f) => f) });
	assert.deepEqual(map, { a: "tracked", b: "ignored", "d/1": "tracked", "d/2": "ignored" });
	assert.equal(buildMap({ tracked: ["x/a"], all: ["x/a", "x/b"].map((f) => f) })["x/a"], "tracked");
});

test("diffMaps prints + for a new file, - for a vanished one, ~ for a git change", () => {
	const golden = { keep: { git: "tracked" }, gone: { git: "ignored" }, moved: { git: "tracked" } };
	const actual = { keep: "tracked", moved: "ignored", fresh: "tracked" };
	assert.deepEqual(diffMaps(golden, actual), ["+ fresh  (tracked)", "- gone  (ignored)", "~ moved  tracked -> ignored"]);
});

test("the golden map has an owner and a reason for every file", () => {
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
	for (const [file, v] of Object.entries(golden)) {
		assert.ok(OWNERS.includes(v.owner), `${file}: owner must be one of ${OWNERS.join(", ")}`);
		assert.ok(["tracked", "ignored", "mixed"].includes(v.git), `${file}: git must be tracked, ignored or mixed`);
		assert.ok(v.why && v.why.length > 3, `${file}: say why Flisk writes it`);
	}
});

test("a Docker-mode project writes exactly the files in file-map.json", { timeout: 240_000 }, () => {
	const dir = makeProjectDir(7);
	try {
		mkdirSync(dir, { recursive: true });
		spawnSync(process.env.ORACLE_GIT ?? "git", ["init", "-q", "."], { cwd: dir });
		for (const args of [["project", "--yes"], ["resource", "api", "--type", "backend", "--stack", "app", "--yes"], ["config", "regenerate"]]) {
			const r = runFlisk(dir, args);
			assert.equal(r.code, 0, `flisk ${args.join(" ")} exited ${r.code}: ${(r.stderr || r.stdout).slice(0, 300)}`);
		}
		const actual = buildMap(gitFiles(dir));
		const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
		if (process.env.FILE_MAP_UPDATE === "1") {
			const next = Object.fromEntries(Object.entries(actual).map(([k, git]) => [k, { owner: golden[k]?.owner ?? "TODO", git, why: golden[k]?.why ?? "TODO: say why Flisk writes it" }]));
			writeFileSync(GOLDEN, `${JSON.stringify(next, null, "\t")}\n`);
			return;
		}
		assert.deepEqual(diffMaps(golden, actual), [], "Flisk's file map changed; if that is on purpose rerun with FILE_MAP_UPDATE=1 and fill in owner and why");
		// The map and `flisk config explain` are two answers to "who owns this file"; they must agree on every plain file.
		const disagree = [];
		for (const [key, v] of Object.entries(golden)) {
			const rel = key.replace("<stack>", "app").replace("<service>", "api");
			const abs = path.join(dir, rel);
			if (key.includes("**") || key.includes("<skill>") || !existsSync(abs) || !lstatSync(abs).isFile()) continue;
			const said = ownershipOf(dir, rel);
			const want = v.owner === "generated" || v.owner === "vendored" ? "generated" : "user-owned";
			if (said !== want) disagree.push(`${rel}: file-map.json says ${v.owner}, flisk config explain says ${said}`);
		}
		assert.deepEqual(disagree, []);
	} finally {
		rmSync(path.dirname(dir), { recursive: true, force: true });
	}
});
