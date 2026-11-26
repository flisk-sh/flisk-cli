// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Manifest reading for scripts/security-alert-issues.mjs: the version a manifest
// pins for a package, read out of package.json, requirements files and lockfiles.
//   node --test scripts/security-alert-issues/manifests.test.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assessPinnedVersion } from "./versions.mjs";

/**
 * The version a manifest pins for a package.
 *
 * A pip requirements file written by pip-compile pins one version per package
 * (`name==version`). A package.json declares a range, which says what is allowed
 * rather than what is installed. A lockfile pins a resolved tree, not a version.
 * The kind says which of those the manifest turned out to be: `pinned`, `range` or
 * `unknown`.
 */
export const PINNED_KIND = { PINNED: "pinned", RANGE: "range", UNKNOWN: "unknown" };

/** PEP 503 name normalisation: lower case, and runs of -, _ and . become one -. */
export function normalizePackageName(name) {
	return String(name ?? "")
		.trim()
		.toLowerCase()
		.replace(/[-_.]+/g, "-");
}

/**
 * The requirement a requirements file states for a package: the spec and whether it
 * is an exact pin. A pip-compile file writes the pin over two lines, the
 * requirement and its hashes continued with a backslash.
 */
export function requirementFor(text, packageName) {
	const wanted = normalizePackageName(packageName);
	if (!wanted) return null;
	for (const line of String(text ?? "").split(/\r?\n/)) {
		const requirement = line.replace(/\\$/, "").split(/\s#/)[0].trim();
		if (!requirement || requirement.startsWith("#")) continue;
		const name = /^[A-Za-z0-9._-]+/.exec(requirement)?.[0];
		if (!name) continue;
		if (normalizePackageName(name) !== wanted) continue;
		const spec = requirement.slice(name.length).trimStart().replace(/^\[[^\]]*\]/, "").trim();
		if (spec && !/^[=<>!~]/.test(spec)) continue;
		return { spec, exact: /^==\s*[A-Za-z0-9._*+!-]+$/.test(spec) };
	}
	return null;
}

/** The version a requirements file pins for a package, or null when it pins a range. */
export function pinnedVersionFromRequirements(text, packageName) {
	const requirement = requirementFor(text, packageName);
	if (!requirement?.exact) return null;
	return requirement.spec.replace(/^==\s*/, "").trim();
}

/**
 * The dependency a package.json declares for a package.
 *
 * An exact version is a pin. Anything else is a range, which says what is allowed,
 * not what is installed, so the version could not be read.
 */
export function pinnedVersionFromPackageJson(text, packageName) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	for (const group of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		const dependencies = parsed?.[group];
		if (!dependencies || typeof dependencies !== "object") continue;
		const entry = Object.entries(dependencies).find(([name]) => name === packageName);
		if (!entry) continue;
		const range = String(entry[1] ?? "").trim();
		if (!range) continue;
		if (/^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/.test(range)) {
			return { version: range, range: null, kind: PINNED_KIND.PINNED };
		}
		return { version: null, range, kind: PINNED_KIND.RANGE };
	}
	return null;
}

/** Whether a manifest is a lockfile, which pins a resolved tree rather than a version. */
export function isLockfile(manifestPath) {
	return /(^|\/)(bun\.lock|bun\.lockb|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock)$/.test(
		String(manifestPath ?? ""),
	);
}

/**
 * The version the manifest the alert names pins for the package.
 *
 * The manifest is read as text: a requirements file pins one version, a
 * package.json declares a range, and anything else pins no version at all.
 */
export function pinnedVersionFor(manifestText, packageName, manifestPath) {
	const empty = { version: null, range: null, kind: PINNED_KIND.UNKNOWN };
	if (manifestText === null || manifestText === undefined) return empty;
	const path = String(manifestPath ?? "");
	if (path.endsWith("package.json")) {
		return pinnedVersionFromPackageJson(manifestText, packageName) ?? empty;
	}
	if (path.endsWith(".txt") || path.endsWith(".in")) {
		const version = pinnedVersionFromRequirements(manifestText, packageName);
		if (version) return { version, range: null, kind: PINNED_KIND.PINNED };
		const requirement = requirementFor(manifestText, packageName);
		if (requirement) return { version: null, range: requirement.spec, kind: PINNED_KIND.RANGE };
	}
	return empty;
}

/** Why the version could not be read, in words a contributor can act on. */
export function pinnedVersionReason(pinned, manifestPath) {
	if (pinned?.kind === PINNED_KIND.RANGE) {
		return `the manifest pins a range (\`${pinned.range}\`), not one version`;
	}
	if (isLockfile(manifestPath)) {
		return "the manifest is a lockfile, so it pins a resolved tree rather than one version";
	}
	return "the manifest carries no version for this package";
}

/** The manifest the alert names, read from the checkout the script runs in. */
function readManifestText(manifestPath) {
	try {
		return readFileSync(resolve(process.cwd(), manifestPath), "utf8");
	} catch {
		return null;
	}
}

/**
 * The version the manifest the alert names pins for the package.
 *
 * A manifest that pins a version answers the question on its own. A manifest that
 * does not (a lockfile, a package.json that declares a range) leaves the scanner's
 * resolved version as the answer, because that is the version the alert is about.
 */
export function readPinnedVersion(finding, readManifest = readManifestText) {
	const manifestText = finding.manifestPath ? readManifest(finding.manifestPath) : null;
	const fromManifest = pinnedVersionFor(manifestText, finding.packageName, finding.manifestPath);
	if (fromManifest.kind === PINNED_KIND.PINNED) return fromManifest;
	if (finding.installedVersion) {
		return { version: finding.installedVersion, range: null, kind: PINNED_KIND.PINNED };
	}
	return fromManifest;
}

/**
 * The finding with the version the manifest pins and what it means for the advisory.
 *
 * The pinned version and the fixed version decide whether the advisory reaches this
 * repository, so both are read before the issue is written.
 */
export function assessFinding(finding, readManifest = readManifestText) {
	const pinned = readPinnedVersion(finding, readManifest);
	return {
		...finding,
		pinned,
		assessment: assessPinnedVersion({
			pinned,
			patched: finding.patchedVersion,
			range: finding.vulnerableRange,
			reason: pinnedVersionReason(pinned, finding.manifestPath),
		}),
	};
}
