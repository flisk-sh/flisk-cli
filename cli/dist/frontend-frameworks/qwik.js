// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
export const qwikFrontendProvider = {
    id: "qwik",
    label: "Qwik + Vite",
    vite: {
        imports: ["import { qwikVite } from '@builder.io/qwik/optimizer';"],
        plugins: ["qwikVite({ csr: true })"],
    },
    dependencies: {
        "@builder.io/qwik": "^1.12.0",
    },
    devDependencies: {},
    compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "@builder.io/qwik",
    },
    createFiles(name) {
        return [
            createFrontendHtmlFile(name, '<div id="app"></div>', "/src/main.tsx"),
            {
                filename: "src/main.tsx",
                content: `import '@builder.io/qwik/qwikloader.js';
import { render } from '@builder.io/qwik';
import { App } from './App';

render(document.getElementById('app') as HTMLElement, <App />);
`,
                description: "Generating Qwik entry",
                emoji: "💻",
            },
            {
                filename: "src/App.tsx",
                content: `import { component$ } from '@builder.io/qwik';

export const App = component$(() => {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>${name}</h1>
      <p>Frontend resource created with Flisk</p>
    </div>
  );
});
`,
                description: "Generating Qwik app",
                emoji: "💻",
            },
        ];
    },
};
