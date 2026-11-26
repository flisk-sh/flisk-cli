#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Post-publish smoke check (#3090). The version just pushed to npm is installed globally by
// .github/actions/install-flisk (npm i -g @flisk-sh/flisk@<version>); this script proves what it
// installed actually runs and carries the build of the released commit. A tarball that misses its
// bundle is what 1.4.30 shipped (#3054): it passed every pre-publish check and was caught a day
// later by users. Run by the post-publish-smoke job in release-binaries.yml; a failure fails the
// run and opens an issue.
//   node scripts/post-publish-smoke.mjs --version <v> --commit <sha> [--package @flisk-sh/flisk]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

// The bundle prepack emits (cli/scripts/bundle.mjs) and the marker it writes. bin/flisk.js prefers
// dist-bundle/ when it exists, so `flisk --version` exercises the bundle end to end.
export const BUNDLE_ENTRY = "cli/dist-bundle/cli.js";
export const BUILD_INFO = "cli/dist-bundle/build-info.json";
// The pack step in release-binaries.yml records the published commit at the package root.
export const SOURCE_SHA = ".sourceSHA";

/** The installed package directory under a global npm root: <root>/@flisk-sh/flisk. */
export const globalPackageDir = (pkg, npmRoot) => join(npmRoot, ...pkg.split("/"));

/**
 * `name` as a fixed path, found by the same PATH walk the OS does, so the spawn calls below hand
 * execFileSync a resolved binary instead of a PATH search (javascript:S4036). A name PATH has no
 * match for falls back to the bare name, which fails the way it always did.
 */
export function commandPath(name, pathEnv = process.env.PATH ?? "") {
	const names =
		process.platform === "win32" ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`] : [name];
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		for (const candidate of names) {
			const file = join(dir, candidate);
			if (existsSync(file)) return file;
		}
	}
	return name;
}

/** The commit a shipped build-info.json records, or null when it is missing or unreadable. */
export function readBuildCommit(packageDir) {
	const file = join(packageDir, BUILD_INFO);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		for (const key of ["commit", "commitSha", "sha"]) {
			if (typeof parsed[key] === "string" && parsed[key].trim()) return parsed[key].trim();
		}
	} catch {
		// falls through to null
	}
	return null;
}

/** The .sourceSHA marker the pack step wrote, or null when absent or blank. */
export function readSourceSha(packageDir) {
	const file = join(packageDir, SOURCE_SHA);
	if (!existsSync(file)) return null;
	const sha = readFileSync(file, "utf8").trim();
	return sha || null;
}

/** `flisk --version` output: the last non-empty stdout line, trimmed (notices go to stderr). */
export function fliskVersion({ exec = execFileSync } = {}) {
	const out = exec(commandPath("flisk"), ["--version"], { encoding: "utf8" });
	return out.split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

/**
 * Every problem with the globally installed package, as strings. `installed` is the
 * `flisk --version` output, or null when the command could not run.
 */
export function checkSmoke({ expectedVersion, expectedCommit, installed, packageDir }) {
	const problems = [];
	if (installed === null) {
		problems.push("`flisk --version` did not run: the installed CLI does not start");
	} else if (installed !== expectedVersion) {
		// Whole-string compare, so 1.4.0 does not accept 11.4.0.
		problems.push(`flisk --version printed "${installed}", expected "${expectedVersion}"`);
	}
	if (!existsSync(join(packageDir, BUNDLE_ENTRY))) {
		problems.push(`installed package has no ${BUNDLE_ENTRY}: the bundle step's output is missing`);
	}
	const buildCommit = readBuildCommit(packageDir);
	if (!buildCommit) {
		problems.push(`installed package has no readable ${BUILD_INFO} commit marker`);
	} else if (buildCommit !== expectedCommit) {
		problems.push(`${BUILD_INFO} records commit ${buildCommit}, expected ${expectedCommit}`);
	}
	const sourceSha = readSourceSha(packageDir);
	if (!sourceSha) {
		problems.push(`installed package has no ${SOURCE_SHA} marker`);
	} else if (sourceSha !== expectedCommit) {
		problems.push(`${SOURCE_SHA} records commit ${sourceSha}, expected ${expectedCommit}`);
	}
	return problems;
}

const main = () => {
	const args = process.argv.slice(2);
	const flag = (name) => {
		const i = args.indexOf(name);
		return i === -1 ? undefined : args[i + 1];
	};

	const pkg = flag("--package") || process.env.NPM_PACKAGE || "@flisk-sh/flisk";
	const version = flag("--version") || process.env.NPM_VERSION;
	const expectedCommit = flag("--commit") || process.env.EXPECTED_COMMIT;

	if (!version || !expectedCommit) {
		console.error("usage: post-publish-smoke.mjs --package <pkg> --version <ver> --commit <sha>");
		process.exit(2);
	}

	const npmRoot = execFileSync(commandPath("npm"), ["root", "-g"], { encoding: "utf8" }).trim();
	const packageDir = globalPackageDir(pkg, npmRoot);
	if (!existsSync(packageDir)) {
		console.error(`::error::${pkg} is not installed at ${packageDir}: npm i -g did not lay it down`);
		process.exit(1);
	}

	let installed = null;
	try {
		installed = fliskVersion();
	} catch (e) {
		console.error(`::warning::flisk --version failed to run: ${e?.message ?? e}`);
	}

	const problems = checkSmoke({ expectedVersion: version, expectedCommit, installed, packageDir });
	if (problems.length > 0) {
		for (const problem of problems) console.error(`::error::${pkg}@${version}: ${problem}`);
		process.exit(1);
	}
	console.log(
		`✓ ${pkg}@${version} installs and runs; ${BUILD_INFO} and ${SOURCE_SHA} record ${expectedCommit}`,
	);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
