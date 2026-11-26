// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { qwikFrontendProvider } from "../qwik.js";

describe("qwik frontend provider", () => {
  it("identifies itself as the Qwik and Vite provider", () => {
    expect(qwikFrontendProvider.id).toBe("qwik");
    expect(qwikFrontendProvider.label).toBe("Qwik + Vite");
  });

  it("depends on @builder.io/qwik", () => {
    expect(qwikFrontendProvider.dependencies["@builder.io/qwik"]).toBeDefined();
    expect(qwikFrontendProvider.devDependencies["@builder.io/qwik"]).toBeUndefined();
  });

  it("creates the expected non-empty files in order", () => {
    const files = qwikFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });

  it("uses the project name in the HTML title and the app heading", () => {
    const files = qwikFrontendProvider.createFiles("my-app");

    const indexFile = files.find((file) => file.filename === "index.html");
    expect(indexFile?.content).toContain("<title>my-app</title>");

    const appFile = files.find((file) => file.filename === "src/App.tsx");
    expect(appFile?.content).toContain("<h1>my-app</h1>");

    const renamed = qwikFrontendProvider.createFiles("renamed-app");
    expect(renamed.find((file) => file.filename === "index.html")?.content).toContain(
      "<title>renamed-app</title>",
    );
    expect(renamed.find((file) => file.filename === "src/App.tsx")?.content).toContain(
      "<h1>renamed-app</h1>",
    );
  });
});
