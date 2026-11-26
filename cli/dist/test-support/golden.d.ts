export interface GoldenFileExpectation {
    /** Generated file path relative to the project root. */
    file: string;
    /** Strings the generated file must contain. */
    contains: string[];
}
export interface GoldenHashCheck {
    /** Generated file path, for messages and the update log. */
    file: string;
    /** Hash pinned in the test source. */
    pinned: string;
    /** Freshly computed hash of the generated file. */
    actual: string;
    /** Absolute path of the test file holding the pin (fileURLToPath(import.meta.url)). */
    testFile: string;
}
/** True when the suite runs with UPDATE_GOLDEN=1. */
export declare function goldenUpdate(): boolean;
/**
 * Assert that `<root>/<file>` exists, is non-empty and carries every marker in `contains`.
 * Returns the file text so the caller can hash it.
 */
export declare function expectGeneratedFile(root: string, { file, contains }: GoldenFileExpectation): string;
/**
 * Assert `actual` equals the pinned hash; the failure message names the new hash and the update
 * command. With UPDATE_GOLDEN=1 the pin in `testFile` is rewritten to `actual` instead of failing.
 * Every quoted occurrence moves, so entries that share one content hash (the `.tiltignore` pair)
 * update together. When the pin is not a quoted literal in the source a ready-to-paste `sha256:`
 * line is printed for a hand edit.
 */
export declare function expectPinnedHash(check: GoldenHashCheck): void;
