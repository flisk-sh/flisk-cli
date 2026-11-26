// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The small semver implementation for scripts/security-alert-issues.mjs: parsing,
// comparing, caret and tilde ranges, and "is this version in the vulnerable range".
// Nothing here knows what an alert is.
//   node --test scripts/security-alert-issues/versions.test.mjs

/** A version split into its numbers and the pre-release suffix after them. */
export function parseVersion(value) {
	const text = String(value ?? "")
		.trim()
		.replace(/^v/i, "");
	const match = /^\d+(?:\.\d+)*/.exec(text);
	if (!match) return null;
	return {
		numbers: match[0].split(".").map(Number),
		suffix: text.slice(match[0].length).replace(/^[.\-_+]/, ""),
	};
}

/**
 * Compare two versions: -1 when the first is older, 0 when they are the same, 1 when
 * it is newer. null when either version cannot be read.
 */
export function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return null;
	const length = Math.max(left.numbers.length, right.numbers.length);
	for (let index = 0; index < length; index += 1) {
		const leftNumber = left.numbers[index] ?? 0;
		const rightNumber = right.numbers[index] ?? 0;
		if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
	}
	// A pre-release comes before the release it leads to: 1.0.0rc1 is older than 1.0.0.
	if (left.suffix === right.suffix) return 0;
	if (!left.suffix) return 1;
	if (!right.suffix) return -1;
	return left.suffix < right.suffix ? -1 : 1;
}

/** The two bounds a caret range allows: `^1.2.3` is at least 1.2.3 and below 2.0.0. */
function caretBounds(version) {
	const parsed = parseVersion(version);
	if (!parsed) return null;
	const upper = [...parsed.numbers];
	let index = 0;
	while (index < upper.length && upper[index] === 0) index += 1;
	const position = index === upper.length ? 0 : index;
	upper[position] += 1;
	for (let rest = position + 1; rest < upper.length; rest += 1) upper[rest] = 0;
	return [
		{ op: ">=", version },
		{ op: "<", version: upper.join(".") },
	];
}

/** The two bounds a tilde range allows: `~1.2.3` is at least 1.2.3 and below 1.3.0. */
function tildeBounds(version) {
	const parsed = parseVersion(version);
	if (!parsed) return null;
	const upper = [...parsed.numbers];
	if (upper.length >= 2) {
		upper[upper.length - 2] += 1;
		upper[upper.length - 1] = 0;
	} else {
		upper[0] += 1;
	}
	return [
		{ op: ">=", version },
		{ op: "<", version: upper.join(".") },
	];
}

/**
 * A range read into its constraints. `>= 1.0, < 2.0` becomes two constraints and
 * `1.0 || 2.0` two alternatives. null when the range cannot be read.
 */
export function parseVersionRange(range) {
	const text = String(range ?? "").trim();
	if (!text) return null;
	const alternatives = [];
	for (const alternative of text.split("||")) {
		const constraints = [];
		// A range may separate its constraints with a comma or with a space.
		let rest = alternative.replace(/,/g, " ").trim();
		while (rest) {
			const match = /^\s*((?:>=|<=|==|!=|>|<|=|\^|~)\s*)?([^\s,>=<!^~][^\s,]*)/.exec(rest);
			if (!match) return null;
			rest = rest.slice(match[0].length);
			const op = (match[1] ?? "==").trim();
			const version = match[2];
			// A wildcard says nothing about the version it stands for.
			if (!version || /[*xX]/.test(version) || !parseVersion(version)) return null;
			if (op === "^") {
				const bounds = caretBounds(version);
				if (!bounds) return null;
				constraints.push(...bounds);
			} else if (op === "~") {
				const bounds = tildeBounds(version);
				if (!bounds) return null;
				constraints.push(...bounds);
			} else {
				constraints.push({ op, version });
			}
		}
		if (!constraints.length) return null;
		alternatives.push(constraints);
	}
	return alternatives.length ? alternatives : null;
}

/** Whether one version meets one constraint. */
function satisfies(version, constraint) {
	const compared = compareVersions(version, constraint.version);
	if (compared === null) return false;
	switch (constraint.op) {
		case ">=":
			return compared >= 0;
		case ">":
			return compared > 0;
		case "<=":
			return compared <= 0;
		case "<":
			return compared < 0;
		case "!=":
			return compared !== 0;
		default:
			return compared === 0;
	}
}

/**
 * Whether a version falls inside a range. null when the range cannot be read, so
 * the caller falls back to the fixed version.
 */
export function versionInRange(version, range) {
	const parsed = parseVersionRange(range);
	if (!parsed) return null;
	if (!parseVersion(version)) return null;
	return parsed.some((constraints) => constraints.every((constraint) => satisfies(version, constraint)));
}

/**
 * What the version the manifest pins means for the advisory.
 *
 * `affected` when the pinned version is inside the vulnerable range, `not-affected`
 * when it is the fixed version or newer, and `unknown` when the version could not be
 * read or the advisory carries no range to read it against. The judgement stays with
 * a person when the answer is unknown.
 */
export function assessPinnedVersion({ pinned, patched, range, reason }) {
	const version = pinned?.version ?? null;
	if (!version) {
		return {
			status: "unknown",
			verdict: "The pinned version could not be read",
			reason: reason ?? "the manifest carries no version for this package",
		};
	}
	const inRange = range ? versionInRange(version, range) : null;
	if (inRange === true) {
		return {
			status: "affected",
			verdict: "The pinned version is affected",
			reason: "it is inside the vulnerable range",
		};
	}
	if (inRange === false) {
		return {
			status: "not-affected",
			verdict: "The pinned version is not affected",
			reason: "it is outside the vulnerable range",
		};
	}
	if (patched) {
		const compared = compareVersions(version, patched);
		if (compared !== null) {
			if (compared < 0) {
				return {
					status: "affected",
					verdict: "The pinned version is affected",
					reason: `it is before the fixed version ${patched}`,
				};
			}
			return {
				status: "not-affected",
				verdict: "The pinned version is not affected",
				reason:
					compared === 0
						? `it is the fixed version ${patched}`
						: `it is newer than the fixed version ${patched}`,
			};
		}
	}
	return {
		status: "unknown",
		verdict: "The pinned version could not be compared",
		reason: "the advisory carries no range or fixed version to compare it with",
	};
}
