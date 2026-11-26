// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { preactFrontendProvider } from "../preact.js";

describe("preact frontend provider", () => {
  it("identifies itself as the Preact and Vite provider", () => {
    expect(preactFrontendProvider.id).toBe("preact");
    expect(preactFrontendProvider.label).toBe("Preact + Vite");
  });

  it("declares the Preact runtime and preset dependencies", () => {
    expect(preactFrontendProvider.dependencies).toMatchObject({ preact: expect.any(String) });
    expect(preactFrontendProvider.devDependencies).toMatchObject({
      "@preact/preset-vite": expect.any(String),
    });
  });

  it("compiles JSX with Preact as the import source", () => {
    expect(preactFrontendProvider.compilerOptions.jsxImportSource).toBe("preact");
  });

  it("wires the Preact preset into the local Vite config", () => {
    expect(preactFrontendProvider.vite?.imports).toEqual([
      "import preact from '@preact/preset-vite';",
    ]);
    expect(preactFrontendProvider.vite?.plugins).toEqual(["preact()"]);
  });

  it("creates the expected non-empty files in order", () => {
    const files = preactFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });

  it("uses the project name in the HTML title", () => {
    const indexFile = preactFrontendProvider
      .createFiles("my-app")
      .find((file) => file.filename === "index.html");

    expect(indexFile?.content).toContain("<title>my-app</title>");
  });
});
