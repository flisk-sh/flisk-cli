// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
/** True when the suite runs with UPDATE_GOLDEN=1. */
export function goldenUpdate() {
    return process.env.UPDATE_GOLDEN === "1";
}
/**
 * Assert that `<root>/<file>` exists, is non-empty and carries every marker in `contains`.
 * Returns the file text so the caller can hash it.
 */
export function expectGeneratedFile(root, { file, contains }) {
    const full = join(root, file);
    expect(existsSync(full), `${file} exists`).toBe(true);
    const text = readFileSync(full, "utf-8");
    expect(text.length, `${file} is not empty`).toBeGreaterThan(0);
    for (const needle of contains) {
        expect(text, `${file} contains ${needle}`).toContain(needle);
    }
    return text;
}
/**
 * Assert `actual` equals the pinned hash; the failure message names the new hash and the update
 * command. With UPDATE_GOLDEN=1 the pin in `testFile` is rewritten to `actual` instead of failing.
 * Every quoted occurrence moves, so entries that share one content hash (the `.tiltignore` pair)
 * update together. When the pin is not a quoted literal in the source a ready-to-paste `sha256:`
 * line is printed for a hand edit.
 */
export function expectPinnedHash(check) {
    const { file, pinned, actual } = check;
    if (goldenUpdate()) {
        repinHash(check);
        return;
    }
    expect(actual, `${file} hashes to ${actual}; re-pin a deliberate change with UPDATE_GOLDEN=1 bun run test -- tests/generated`).toBe(pinned);
}
function repinHash({ file, pinned, actual, testFile }) {
    if (actual === pinned)
        return;
    const source = readFileSync(testFile, "utf-8");
    const rewritten = source.split(`"${pinned}"`).join(`"${actual}"`);
    if (rewritten !== source) {
        writeFileSync(testFile, rewritten);
        console.log(`UPDATE_GOLDEN re-pinned ${file}: ${pinned} -> ${actual}`);
    }
    else if (source.includes(`"${actual}"`)) {
        console.log(`UPDATE_GOLDEN ${file}: already pinned to ${actual}`);
    }
    else {
        console.log(`UPDATE_GOLDEN ${file}: sha256: "${actual}"`);
    }
}
