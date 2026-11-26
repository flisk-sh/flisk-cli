// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { tanstackRouterFrontendProvider } from "../tanstack-router.js";

describe("tanstack-router frontend provider", () => {
  it("identifies itself as the TanStack Router, React and Vite provider", () => {
    expect(tanstackRouterFrontendProvider.id).toBe("tanstack-router");
    expect(tanstackRouterFrontendProvider.label).toBe("TanStack Router + React + Vite");
  });

  it("creates exactly the expected files in order", () => {
    const files = tanstackRouterFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/router.tsx",
    ]);
  });

  it("uses the project name in the HTML title and the index route heading", () => {
    const files = tanstackRouterFrontendProvider.createFiles("my-app");
    const indexFile = files.find((file) => file.filename === "index.html");
    const routerFile = files.find((file) => file.filename === "src/router.tsx");
    const mainFile = files.find((file) => file.filename === "src/main.tsx");

    expect(indexFile?.content).toContain("<title>my-app</title>");
    expect(routerFile?.content).toContain("<h1>my-app</h1>");
    expect(mainFile?.content).not.toContain("my-app");
  });

  it("declares the TanStack Router, React and Vite plugin dependencies", () => {
    expect(tanstackRouterFrontendProvider.dependencies).toMatchObject({
      "@tanstack/react-router": expect.any(String),
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
    expect(tanstackRouterFrontendProvider.devDependencies).toMatchObject({
      "@vitejs/plugin-react": expect.any(String),
    });
  });

  it("generates no empty files", () => {
    const files = tanstackRouterFrontendProvider.createFiles("my-app");

    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });
});
