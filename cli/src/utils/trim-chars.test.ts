// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { trimChar, trimEndChar, trimStartChar } from "./trim-chars.js";

describe("trim-chars", () => {
  it("trims only the requested side", () => {
    expect(trimStartChar("--a-b--", "-")).toBe("a-b--");
    expect(trimEndChar("--a-b--", "-")).toBe("--a-b");
    expect(trimChar("--a-b--", "-")).toBe("a-b");
  });
  it("handles all-trim and empty input", () => {
    expect(trimChar("----", "-")).toBe("");
    expect(trimChar("", "-")).toBe("");
    expect(trimEndChar("///", "/")).toBe("");
  });
  it("is linear on long runs", () => {
    expect(trimEndChar(`a${"/".repeat(200000)}`, "/")).toBe("a");
  });
});
