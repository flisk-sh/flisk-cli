// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { solidFrontendProvider } from "../solid.js";

describe("solid frontend provider", () => {
  it("identifies itself as the Solid + Vite provider", () => {
    expect(solidFrontendProvider.id).toBe("solid");
    expect(solidFrontendProvider.label).toBe("Solid + Vite");
  });

  it("declares the Solid runtime and Vite plugin dependencies", () => {
    expect(solidFrontendProvider.dependencies).toHaveProperty("solid-js");
    expect(solidFrontendProvider.devDependencies).toHaveProperty("vite-plugin-solid");
  });

  it("creates exactly the expected non-empty files in order", () => {
    const files = solidFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });

  it("uses the project name in the HTML title", () => {
    const indexFile = solidFrontendProvider
      .createFiles("my-app")
      .find((file) => file.filename === "index.html");

    expect(indexFile?.content).toContain("<title>my-app</title>");
  });

  it("configures vite-plugin-solid for local dev", () => {
    expect(solidFrontendProvider.vite?.imports).toEqual(["import solid from 'vite-plugin-solid';"]);
    expect(solidFrontendProvider.vite?.plugins).toEqual(["solid()"]);
  });
});
