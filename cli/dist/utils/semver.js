// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/** Parses a semver version string, extracting major, minor, patch, and prerelease identifiers. */
export function parseSemver(raw) {
    const cleaned = raw.trim().replace(/^v/, "").split("+")[0];
    const match = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
    if (!match)
        return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3] ?? 0);
    const prereleaseRaw = match[4];
    const prerelease = prereleaseRaw
        ? prereleaseRaw.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
        : [];
    return { major, minor, patch, prerelease };
}
/**
 * Compares two semver version strings per the SemVer 2.0.0 specification:
 * Returns 1 if a > b, -1 if a < b, 0 if a === b, or null if either is unparseable.
 */
export function compareSemver(aStr, bStr) {
    const a = parseSemver(aStr);
    const b = parseSemver(bStr);
    if (!a || !b)
        return null;
    if (a.major !== b.major)
        return a.major > b.major ? 1 : -1;
    if (a.minor !== b.minor)
        return a.minor > b.minor ? 1 : -1;
    if (a.patch !== b.patch)
        return a.patch > b.patch ? 1 : -1;
    const aHasPre = a.prerelease.length > 0;
    const bHasPre = b.prerelease.length > 0;
    // A normal version has greater precedence than a prerelease of the same major.minor.patch
    if (aHasPre && !bHasPre)
        return -1;
    if (!aHasPre && bHasPre)
        return 1;
    if (!aHasPre && !bHasPre)
        return 0;
    const len = Math.max(a.prerelease.length, b.prerelease.length);
    for (let i = 0; i < len; i++) {
        const pA = a.prerelease[i];
        const pB = b.prerelease[i];
        if (pA === undefined)
            return -1;
        if (pB === undefined)
            return 1;
        if (pA === pB)
            continue;
        const numA = typeof pA === "number";
        const numB = typeof pB === "number";
        if (numA && !numB)
            return -1;
        if (!numA && numB)
            return 1;
        if (numA && numB) {
            return pA > pB ? 1 : -1;
        }
        return pA.localeCompare(pB) > 0 ? 1 : -1;
    }
    return 0;
}
