// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { litFrontendProvider } from "../lit.js";

describe("lit frontend provider", () => {
  it("identifies itself as the Lit and Vite provider", () => {
    expect(litFrontendProvider.id).toBe("lit");
    expect(litFrontendProvider.label).toBe("Lit + Vite");
  });

  it("declares lit as a dependency", () => {
    expect(litFrontendProvider.dependencies).toMatchObject({ lit: expect.any(String) });
    expect(litFrontendProvider.devDependencies).toEqual({});
  });

  it("creates the expected non-empty files in order", () => {
    const files = litFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/app-root.ts",
    ]);
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });

  it("uses the project name in the HTML title", () => {
    const indexFile = litFrontendProvider
      .createFiles("my-app")
      .find((file) => file.filename === "index.html");

    expect(indexFile?.content).toContain("<title>my-app</title>");
  });
});
