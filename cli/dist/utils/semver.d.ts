/** A semver version broken into numeric parts and prerelease identifiers. */
export interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
    prerelease: (string | number)[];
}
/** Parses a semver version string, extracting major, minor, patch, and prerelease identifiers. */
export declare function parseSemver(raw: string): ParsedSemver | null;
/**
 * Compares two semver version strings per the SemVer 2.0.0 specification:
 * Returns 1 if a > b, -1 if a < b, 0 if a === b, or null if either is unparseable.
 */
export declare function compareSemver(aStr: string, bStr: string): number | null;
