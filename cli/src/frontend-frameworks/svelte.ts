// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
import type { FrontendFrameworkProvider } from "./types.js";

export const svelteFrontendProvider: FrontendFrameworkProvider = {
  id: "svelte",
  label: "Svelte + Vite",
  vite: {
    imports: ["import { svelte } from '@sveltejs/vite-plugin-svelte';"],
    plugins: ["svelte()"],
  },
  dependencies: {
    svelte: "^5.0.0",
  },
  devDependencies: {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
  },
  compilerOptions: {},
  createFiles(name) {
    return [
      createFrontendHtmlFile(name, '<div id="app"></div>', "/src/main.ts"),
      {
        filename: "src/main.ts",
        content: `import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
`,
        description: "Generating Svelte entry",
        emoji: "💻",
      },
      {
        filename: "src/App.svelte",
        content: `<script lang="ts">
  const message: string = 'Frontend resource created with Flisk';
</script>

<main style="padding: 2rem; font-family: system-ui">
  <h1>${name}</h1>
  <p>{message}</p>
</main>
`,
        description: "Generating Svelte app",
        emoji: "💻",
      },
      {
        filename: "src/vite-env.d.ts",
        content: `/// <reference types="svelte" />
/// <reference types="vite/client" />
`,
        description: "Generating Svelte module types",
        emoji: "⚙️",
      },
    ];
  },
};
