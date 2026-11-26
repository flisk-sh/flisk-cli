// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
import type { FrontendFrameworkProvider } from "./types.js";

export const vanillaFrontendProvider: FrontendFrameworkProvider = {
  id: "vanilla",
  label: "Vanilla TypeScript + Vite",
  vite: { imports: [], plugins: [] },
  dependencies: {},
  devDependencies: {},
  compilerOptions: {},
  createFiles(name) {
    return [
      createFrontendHtmlFile(name, '<div id="app"></div>', "/src/main.ts"),
      {
        filename: "src/main.ts",
        content: `import { renderApp } from './app';

const root = document.getElementById('app');
if (root) {
  renderApp(root);
}
`,
        description: "Generating vanilla entry",
        emoji: "💻",
      },
      {
        filename: "src/app.ts",
        content: `export function renderApp(root: HTMLElement): void {
  root.style.padding = '2rem';
  root.style.fontFamily = 'system-ui';

  const title = document.createElement('h1');
  title.textContent = '${name}';

  const note = document.createElement('p');
  note.textContent = 'Frontend resource created with Flisk';

  root.replaceChildren(title, note);
}
`,
        description: "Generating vanilla app",
        emoji: "💻",
      },
    ];
  },
};
