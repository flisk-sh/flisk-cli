// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  describe,
  discoverResourcesFromRoot,
  expect,
  FliskError,
  getFrontendFramework,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  resolveFrontendFramework,
  rmSync,
  tmpdir,
  writeFileSync,
} from "./test-support.js";

describe("frontend framework providers", () => {
  it("uses React when the framework is omitted, normalizes case, and rejects unknown ids", () => {
    expect(getFrontendFramework().id).toBe("react");
    expect(getFrontendFramework("vue").id).toBe("vue");
    expect(getFrontendFramework("svelte").id).toBe("svelte");
    expect(getFrontendFramework("preact").id).toBe("preact");
    expect(getFrontendFramework("lit").id).toBe("lit");
    expect(getFrontendFramework("vanilla").id).toBe("vanilla");
    expect(getFrontendFramework("solid").id).toBe("solid");
    expect(getFrontendFramework("qwik").id).toBe("qwik");
    expect(() => getFrontendFramework("angular")).toThrow(
      /Supported frameworks: react, vue, svelte, preact, lit, solid, qwik, vanilla, tanstack-router/,
    );
    expect(() => getFrontendFramework("__proto__")).toThrow(/Unknown frontend framework/);
    expect(getFrontendFramework("React").id).toBe("react");
    expect(getFrontendFramework(" VUE ").id).toBe("vue");
    expect(() => getFrontendFramework("angular")).toThrow(FliskError);
    expect(() => getFrontendFramework("")).toThrow(/Unknown frontend framework/);
  });

  it("rejects framework selection for resources that take no framework", () => {
    for (const resourceType of ["worker", "sdk"]) {
      expect(() => resolveFrontendFramework(resourceType, "react")).toThrow(
        /only be used with --type frontend or --type backend/,
      );
    }
  });

  it("leaves backend framework ids to the backend registry", () => {
    expect(resolveFrontendFramework("backend", "express")).toBeUndefined();
  });

  it("keeps the existing React entry and component output under the provider", () => {
    const provider = getFrontendFramework();
    const files = provider.createFiles("sample-web");

    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files[0]?.content).toContain("<title>sample-web</title>");
    expect(files[0]?.content).toContain("/src/main.tsx");
    expect(files[1]?.content).toContain("ReactDOM.createRoot");
    expect(files[2]?.content).toContain("Flisk frontend");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("adds the backend health card to the React starter only when a backend is wired", () => {
    const withBackend = getFrontendFramework().createFiles("sample-web", {
      backendName: "shop-api",
    });
    const app = withBackend.find(({ filename }) => filename === "src/App.tsx")?.content ?? "";

    expect(app).toContain("const API_URL = import.meta.env.VITE_API_URL");
    expect(app).toContain('/// <reference types="vite/client" />');
    expect(app).toContain("fetch(API_URL + '/health'");
    expect(app).toContain("const BACKEND_NAME = 'shop-api'");
    expect(app).toContain("unreachable");
    expect(app).toContain("http://localhost:10350");
    expect(app).toContain("flisk status");

    const standalone = getFrontendFramework().createFiles("sample-web");
    const plainApp = standalone.find(({ filename }) => filename === "src/App.tsx")?.content ?? "";
    expect(plainApp).not.toContain("fetch(");
    expect(plainApp).not.toContain("Backend:");
    expect(plainApp).toContain("Flisk frontend");
    expect(plainApp).toContain("http://localhost:10350");
  });

  it("adds the backend health card to the Vue starter only when a backend is wired", () => {
    const withBackend = getFrontendFramework("vue").createFiles("sample-web", {
      backendName: "shop-api",
    });
    const app = withBackend.find(({ filename }) => filename === "src/App.vue")?.content ?? "";

    expect(app).toContain("import.meta.env.VITE_API_URL");
    expect(app).toContain("fetch(API_URL + '/health')");
    expect(app).toContain("const BACKEND_NAME = 'shop-api'");
    expect(app).toContain("unreachable");

    const plainApp =
      getFrontendFramework("vue")
        .createFiles("sample-web")
        .find(({ filename }) => filename === "src/App.vue")?.content ?? "";
    expect(plainApp).not.toContain("fetch(");
    expect(plainApp).toContain("Flisk frontend");
  });

  it("keeps Vue source and dependencies in its provider", () => {
    const provider = getFrontendFramework("vue");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("vue");
    expect(provider.devDependencies).toHaveProperty("@vitejs/plugin-vue");
    expect(provider.devDependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/App.vue",
      "src/vite-env.d.ts",
    ]);
    expect(files[0]?.content).toContain("/src/main.ts");
    expect(files[1]?.content).toContain("createApp(App).mount('#app')");
    expect(files[2]?.content).toContain('<script setup lang="ts">');
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps Svelte source and dependencies in its provider", () => {
    const provider = getFrontendFramework("svelte");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("svelte");
    expect(provider.devDependencies).toHaveProperty("@sveltejs/vite-plugin-svelte");
    expect(provider.devDependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/App.svelte",
      "src/vite-env.d.ts",
    ]);
    expect(files[0]?.content).toContain("/src/main.ts");
    expect(files[1]?.content).toContain("mount(App");
    expect(files[2]?.content).toContain('<script lang="ts">');
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps Preact source and dependencies in its provider", () => {
    const provider = getFrontendFramework("preact");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("preact");
    expect(provider.dependencies).not.toHaveProperty("react");
    expect(provider.devDependencies).toHaveProperty("@preact/preset-vite");
    expect(provider.devDependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(provider.compilerOptions).toEqual({ jsx: "react-jsx", jsxImportSource: "preact" });
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files[0]?.content).toContain("/src/main.tsx");
    expect(files[1]?.content).toContain("from 'preact'");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });
});

describe("lit provider", () => {
  it("keeps Lit source and dependencies in its provider", () => {
    const provider = getFrontendFramework("lit");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("lit");
    expect(provider.dependencies).not.toHaveProperty("react");
    expect(provider.devDependencies).toEqual({});
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/app-root.ts",
    ]);
    expect(files[0]?.content).toContain("<app-root></app-root>");
    expect(files[2]?.content).toContain("from 'lit'");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps Vanilla TypeScript source in its provider, with no framework dependency", () => {
    const provider = getFrontendFramework("vanilla");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toEqual({});
    expect(provider.devDependencies).toEqual({});
    expect(provider.compilerOptions).toEqual({});
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.ts",
      "src/app.ts",
    ]);
    expect(files[0]?.content).toContain('<div id="app"></div>');
    expect(files[1]?.content).toContain("from './app'");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps Solid source and dependencies in its provider", () => {
    const provider = getFrontendFramework("solid");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("solid-js");
    expect(provider.dependencies).not.toHaveProperty("react");
    expect(provider.devDependencies).toHaveProperty("vite-plugin-solid");
    expect(provider.devDependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(provider.compilerOptions).toEqual({ jsx: "preserve", jsxImportSource: "solid-js" });
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files[1]?.content).toContain("from 'solid-js/web'");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps TanStack Router source and dependencies in its provider", () => {
    const provider = getFrontendFramework("tanstack-router");
    const files = provider.createFiles("sample-web");

    expect(provider.id).toBe("tanstack-router");
    expect(provider.dependencies).toHaveProperty("@tanstack/react-router");
    expect(provider.dependencies).toHaveProperty("react");
    expect(provider.devDependencies).toHaveProperty("@vitejs/plugin-react");
    expect(provider.compilerOptions).toEqual({ jsx: "react-jsx" });
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/router.tsx",
    ]);
    // The app is served under /<name>/, so the router must take Vite's base as its basepath.
    expect(files[1]?.content).toContain("RouterProvider");
    expect(files[2]?.content).toContain("basepath: import.meta.env.BASE_URL");
    // `tsc` fails the image build on import.meta.env without the Vite client types (seen in a real flisk up).
    expect(files[2]?.content).toContain('/// <reference types="vite/client" />');
    expect(files[2]?.content).toContain("createRoute");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });

  it("keeps Qwik source and dependencies in its provider", () => {
    const provider = getFrontendFramework("qwik");
    const files = provider.createFiles("sample-web");

    expect(provider.dependencies).toHaveProperty("@builder.io/qwik");
    expect(provider.dependencies).not.toHaveProperty("react");
    expect(provider.devDependencies).not.toHaveProperty("@vitejs/plugin-react");
    expect(provider.compilerOptions).toEqual({
      jsx: "react-jsx",
      jsxImportSource: "@builder.io/qwik",
    });
    expect(files.map(({ filename }) => filename)).toEqual([
      "index.html",
      "src/main.tsx",
      "src/App.tsx",
    ]);
    expect(files[1]?.content).toContain("render(document.getElementById('app')");
    expect(files[2]?.content).toContain("component$");
    expect(files[2]?.content).toContain("Frontend resource created with Flisk");
    expect(files.some(({ filename }) => filename === "vite.config.ts")).toBe(false);
  });
});

describe("legacy frontend service metadata", () => {
  it("discovers a frontend without framework without rewriting service.json", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "flisk-legacy-frontend-"));
    try {
      const serviceDir = join(projectRoot, "apps", "legacy-web");
      mkdirSync(serviceDir, { recursive: true });
      const servicePath = join(serviceDir, "service.json");
      const original = '{"appName":"legacy-web","appType":"frontend","stack":"main"}\n';
      writeFileSync(servicePath, original);

      const resources = discoverResourcesFromRoot(projectRoot);

      expect(resources).toHaveLength(1);
      expect(resources[0]?.config).not.toHaveProperty("framework");
      expect(readFileSync(servicePath, "utf-8")).toBe(original);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
