// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { bunBackendProvider } from "./bun.js";

describe("Bun backend build outputs", () => {
  it("ignores the shared TypeScript build outputs in the generated service", () => {
    expect(bunBackendProvider.gitignore).toEqual(["dist/", "coverage/", "*.tsbuildinfo"]);
  });
});
