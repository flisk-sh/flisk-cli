// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect } from "vitest";
import { byCodeUnit } from "../utils/compare.js";
/**
 * Asserts that `stdout` is exactly one line of JSON carrying `schemaVersion`, `data` and `errors`, and returns it.
 */
export function parseEnvelope(stdout) {
    const lines = stdout.trim().split(/\r?\n/);
    expect(lines, "stdout must be a single JSON line").toHaveLength(1);
    let parsed;
    try {
        parsed = JSON.parse(lines[0]);
    }
    catch (error) {
        throw new Error(`stdout is not JSON: ${error.message}\n${stdout}`);
    }
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed).sort(byCodeUnit)).toEqual([
        "data",
        "errors",
        "schemaVersion",
    ]);
    const envelope = parsed;
    expect(envelope.schemaVersion).toBeTypeOf("number");
    expect(Array.isArray(envelope.errors)).toBe(true);
    return envelope;
}
