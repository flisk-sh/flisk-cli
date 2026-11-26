// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
export const litFrontendProvider = {
    id: "lit",
    label: "Lit + Vite",
    vite: { imports: [], plugins: [] },
    dependencies: {
        lit: "^3.2.0",
    },
    devDependencies: {},
    compilerOptions: {},
    createFiles(name) {
        return [
            createFrontendHtmlFile(name, "<app-root></app-root>", "/src/main.ts"),
            {
                filename: "src/main.ts",
                content: `import './app-root';
`,
                description: "Generating Lit entry",
                emoji: "💻",
            },
            {
                filename: "src/app-root.ts",
                content: `import { LitElement, css, html } from 'lit';

export class AppRoot extends LitElement {
  static styles = css\`
    :host {
      display: block;
      padding: 2rem;
      font-family: system-ui;
    }
  \`;

  render() {
    return html\`
      <h1>${name}</h1>
      <p>Frontend resource created with Flisk</p>
    \`;
  }
}

customElements.define('app-root', AppRoot);
`,
                description: "Generating Lit app",
                emoji: "💻",
            },
        ];
    },
};
