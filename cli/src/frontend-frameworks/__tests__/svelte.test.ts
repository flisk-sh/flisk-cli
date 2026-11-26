// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { svelteFrontendProvider } from "../svelte.js";

describe("svelte frontend provider", () => {
  it("identifies itself as the Svelte and Vite provider", () => {
    expect(svelteFrontendProvider.id).toBe("svelte");
    expect(svelteFrontendProvider.label).toBe("Svelte + Vite");
  });

  it("declares the svelte dependency and the vite plugin", () => {
    expect(svelteFrontendProvider.dependencies).toMatchObject({
      svelte: expect.any(String),
    });
    expect(svelteFrontendProvider.devDependencies).toMatchObject({
      "@sveltejs/vite-plugin-svelte": expect.any(String),
    });
  });

  it("creates the expected non-empty files in order", () => {
    const files = svelteFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/App.svelte",
      "src/vite-env.d.ts",
    ]);
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });

  it("uses the project name in the HTML title", () => {
    const indexFile = svelteFrontendProvider
      .createFiles("my-app")
      .find((file) => file.filename === "index.html");

    expect(indexFile?.content).toContain("<title>my-app</title>");
  });
});
