// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
export const preactFrontendProvider = {
    id: "preact",
    label: "Preact + Vite",
    vite: {
        imports: ["import preact from '@preact/preset-vite';"],
        plugins: ["preact()"],
    },
    dependencies: {
        preact: "^10.26.0",
    },
    devDependencies: {
        "@preact/preset-vite": "^2.10.0",
    },
    compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "preact",
    },
    createFiles(name) {
        return [
            createFrontendHtmlFile(name, '<div id="app"></div>', "/src/main.tsx"),
            {
                filename: "src/main.tsx",
                content: `import { render } from 'preact';
import App from './App';

render(<App />, document.getElementById('app')!);
`,
                description: "Generating Preact entry",
                emoji: "💻",
            },
            {
                filename: "src/App.tsx",
                content: `function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>${name}</h1>
      <p>Frontend resource created with Flisk</p>
    </div>
  );
}

export default App;
`,
                description: "Generating Preact app",
                emoji: "💻",
            },
        ];
    },
};
