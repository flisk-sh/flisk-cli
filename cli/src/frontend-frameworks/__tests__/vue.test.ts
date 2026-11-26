// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { vueFrontendProvider } from "../vue.js";

describe("vue frontend provider", () => {
  it("identifies itself as the Vue + Vite provider", () => {
    expect(vueFrontendProvider.id).toBe("vue");
    expect(vueFrontendProvider.label).toBe("Vue + Vite");
  });

  it("declares vue and @vitejs/plugin-vue dependencies", () => {
    expect(vueFrontendProvider.dependencies).toHaveProperty("vue");
    expect(vueFrontendProvider.devDependencies).toHaveProperty("@vitejs/plugin-vue");
  });

  it("creates exactly the expected files in order", () => {
    const files = vueFrontendProvider.createFiles("my-app");

    expect(files.map((file) => file.filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/App.vue",
      "src/vite-env.d.ts",
    ]);
  });

  it("uses the project name in the HTML title and the App component", () => {
    const files = vueFrontendProvider.createFiles("my-app");
    const indexFile = files.find((file) => file.filename === "index.html");
    const appFile = files.find((file) => file.filename === "src/App.vue");

    expect(indexFile?.content).toContain("<title>my-app</title>");
    expect(appFile?.content).toContain("my-app");
    expect(appFile?.content).not.toContain("other-app");
  });

  it("shows the renamed resource's own name when a backend is set", () => {
    const files = vueFrontendProvider.createFiles("renamed-app", { backendName: "api" });
    const indexFile = files.find((file) => file.filename === "index.html");
    const appFile = files.find((file) => file.filename === "src/App.vue");

    expect(indexFile?.content).toContain("<title>renamed-app</title>");
    expect(appFile?.content).toContain("renamed-app");
    expect(appFile?.content).not.toContain("my-app");
  });

  it("generates no empty files", () => {
    const files = vueFrontendProvider.createFiles("my-app");
    const filesWithBackend = vueFrontendProvider.createFiles("my-app", { backendName: "api" });

    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
    expect(filesWithBackend.every((file) => file.content.trim().length > 0)).toBe(true);
  });
});
