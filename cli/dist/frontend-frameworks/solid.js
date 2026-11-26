// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
export const solidFrontendProvider = {
    id: "solid",
    label: "Solid + Vite",
    vite: {
        imports: ["import solid from 'vite-plugin-solid';"],
        plugins: ["solid()"],
    },
    dependencies: {
        "solid-js": "^1.9.0",
    },
    devDependencies: {
        "vite-plugin-solid": "^2.11.0",
        jsdom: "^27.4.0",
    },
    compilerOptions: {
        jsx: "preserve",
        jsxImportSource: "solid-js",
    },
    createFiles(name) {
        return [
            createFrontendHtmlFile(name, '<div id="app"></div>', "/src/main.tsx"),
            {
                filename: "src/main.tsx",
                content: `import { render } from 'solid-js/web';
import App from './App';

render(() => <App />, document.getElementById('app')!);
`,
                description: "Generating Solid entry",
                emoji: "💻",
            },
            {
                filename: "src/App.tsx",
                content: `function App() {
  return (
    <div style={{ padding: '2rem', 'font-family': 'system-ui' }}>
      <h1>${name}</h1>
      <p>Frontend resource created with Flisk</p>
    </div>
  );
}

export default App;
`,
                description: "Generating Solid app",
                emoji: "💻",
            },
        ];
    },
};
