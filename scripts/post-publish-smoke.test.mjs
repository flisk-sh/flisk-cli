// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	BUILD_INFO,
	BUNDLE_ENTRY,
	checkSmoke,
	fliskVersion,
	globalPackageDir,
	readBuildCommit,
	readSourceSha,
	SOURCE_SHA,
} from "./post-publish-smoke.mjs";

const VERSION = "1.4.99";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

// A fake installed package: <dir>/cli/dist-bundle/{cli.js,build-info.json} and <dir>/.sourceSHA.
function installedPackage({ buildInfo = { commit: COMMIT, commitSha: COMMIT }, sourceSha = COMMIT } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), "pps-"));
	mkdirSync(path.join(dir, "cli", "dist-bundle"), { recursive: true });
	writeFileSync(path.join(dir, BUNDLE_ENTRY), "// bundle\n");
	if (buildInfo !== null) {
		writeFileSync(path.join(dir, BUILD_INFO), `${JSON.stringify(buildInfo)}\n`);
	}
	if (sourceSha !== null) {
		writeFileSync(path.join(dir, SOURCE_SHA), `${sourceSha}\n`);
	}
	return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const smoke = (over) =>
	checkSmoke({ expectedVersion: VERSION, expectedCommit: COMMIT, installed: VERSION, packageDir: "x", ...over });

test("globalPackageDir resolves the scoped package under the npm root", () => {
	assert.equal(
		globalPackageDir("@flisk-sh/flisk", "/lib/node_modules"),
		path.join("/lib/node_modules", "@flisk-sh", "flisk"),
	);
});

test("fliskVersion returns the last non-empty stdout line, trimmed", () => {
	const exec = () => "  \nnpm notice\n1.4.99  \n";
	assert.equal(fliskVersion({ exec }), "1.4.99");
});

test("readBuildCommit accepts commit, commitSha and sha like the CLI does", () => {
	for (const [marker, want] of [
		[{ commit: COMMIT }, COMMIT],
		[{ commitSha: COMMIT }, COMMIT],
		[{ sha: COMMIT }, COMMIT],
		[{ commit: "  " }, null],
		[{ other: 1 }, null],
	]) {
		const pkg = installedPackage({ buildInfo: marker });
		try {
			assert.equal(readBuildCommit(pkg.dir), want, JSON.stringify(marker));
		} finally {
			pkg.done();
		}
	}
});

test("readSourceSha trims and returns null on a missing or blank marker", () => {
	const pkg = installedPackage({ sourceSha: `  ${COMMIT} ` });
	try {
		assert.equal(readSourceSha(pkg.dir), COMMIT);
	} finally {
		pkg.done();
	}
	const blank = installedPackage({ sourceSha: "   " });
	try {
		assert.equal(readSourceSha(blank.dir), null);
	} finally {
		blank.done();
	}
});

test("a correct install passes", () => {
	const pkg = installedPackage();
	try {
		assert.deepEqual(smoke({ packageDir: pkg.dir }), []);
	} finally {
		pkg.done();
	}
});

test("a CLI that cannot start fails", () => {
	const pkg = installedPackage();
	try {
		assert.deepEqual(smoke({ packageDir: pkg.dir, installed: null }), [
			"`flisk --version` did not run: the installed CLI does not start",
		]);
	} finally {
		pkg.done();
	}
});

test("a wrong version fails on the whole string, not a prefix", () => {
	const pkg = installedPackage();
	try {
		assert.deepEqual(smoke({ packageDir: pkg.dir, installed: "11.4.99" }), [
			'flisk --version printed "11.4.99", expected "1.4.99"',
		]);
	} finally {
		pkg.done();
	}
});

test("a package without the bundle or the markers reports every gap", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "pps-"));
	try {
		assert.deepEqual(smoke({ packageDir: dir }), [
			`installed package has no ${BUNDLE_ENTRY}: the bundle step's output is missing`,
			`installed package has no readable ${BUILD_INFO} commit marker`,
			`installed package has no ${SOURCE_SHA} marker`,
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("markers of another commit fail (the 1.4.30 case)", () => {
	const other = "ffffffffffffffffffffffffffffffffffffffff";
	const pkg = installedPackage({ buildInfo: { commit: other }, sourceSha: other });
	try {
		assert.deepEqual(smoke({ packageDir: pkg.dir }), [
			`${BUILD_INFO} records commit ${other}, expected ${COMMIT}`,
			`${SOURCE_SHA} records commit ${other}, expected ${COMMIT}`,
		]);
	} finally {
		pkg.done();
	}
});
