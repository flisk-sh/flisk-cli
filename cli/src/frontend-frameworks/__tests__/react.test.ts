// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { reactFrontendProvider } from "../react.js";

describe("react frontend provider", () => {
  it("identifies itself as the React + Vite provider", () => {
    expect(reactFrontendProvider.id).toBe("react");
    expect(reactFrontendProvider.label).toBe("React + Vite");
  });

  it("creates exactly index.html, src/main.tsx and src/App.tsx, in order", () => {
    const files = reactFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
  });

  it("uses the project name in the HTML title and in App.tsx", () => {
    const files = reactFrontendProvider.createFiles("my-app");
    const indexFile = files.find((file) => file.filename === "index.html");
    const appFile = files.find((file) => file.filename === "src/App.tsx");

    expect(indexFile?.content).toContain("<title>my-app</title>");
    expect(appFile?.content).toContain("my-app");
  });

  it("renders a backend health card only when backendName is set", () => {
    const appWithBackend = reactFrontendProvider
      .createFiles("my-app", { backendName: "api" })
      .find((file) => file.filename === "src/App.tsx");
    const appWithoutBackend = reactFrontendProvider
      .createFiles("my-app")
      .find((file) => file.filename === "src/App.tsx");

    expect(appWithBackend?.content).toContain("api");
    expect(appWithBackend?.content).toContain("BACKEND_NAME");
    expect(appWithBackend?.content).toContain("/health");

    expect(appWithoutBackend?.content).not.toContain("api");
    expect(appWithoutBackend?.content).not.toContain("BACKEND_NAME");
  });

  it("declares the React runtime and tooling dependencies", () => {
    expect(reactFrontendProvider.dependencies).toMatchObject({
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
    expect(reactFrontendProvider.devDependencies).toMatchObject({
      "@types/react": expect.any(String),
      "@types/react-dom": expect.any(String),
      "@vitejs/plugin-react": expect.any(String),
    });
  });

  it("generates no empty files", () => {
    for (const options of [undefined, { backendName: "api" }]) {
      const files = reactFrontendProvider.createFiles("my-app", options);
      expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
    }
  });
});
