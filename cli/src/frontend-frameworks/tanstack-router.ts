// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createFrontendHtmlFile } from "./html-template.js";
import type { FrontendFrameworkProvider } from "./types.js";

// A client-side Vite SPA using TanStack Router with code-based routes. It shares the React toolchain (same Vite config, JSX
// setting and entry file), so the generators only learn the id. TanStack Start (SSR) is a different contract: bring your own.
export const tanstackRouterFrontendProvider: FrontendFrameworkProvider = {
  id: "tanstack-router",
  label: "TanStack Router + React + Vite",
  vite: {
    imports: ["import react from '@vitejs/plugin-react';"],
    plugins: ["react()"],
  },
  dependencies: {
    "@tanstack/react-router": "^1.0.0",
    react: "^19.0.0",
    "react-dom": "^19.0.0",
  },
  devDependencies: {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
  },
  compilerOptions: {
    jsx: "react-jsx",
  },
  createFiles(name) {
    return [
      createFrontendHtmlFile(name, '<div id="root"></div>', "/src/main.tsx"),
      {
        filename: "src/main.tsx",
        content: `import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { router } from './router';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
`,
        description: "Generating TanStack Router entry",
        emoji: "💻",
      },
      {
        filename: "src/router.tsx",
        content: `/// <reference types="vite/client" />
import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';

const rootRoute = createRootRoute({
  component: () => (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <nav>
        <Link to="/">Home</Link>
      </nav>
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <>
      <h1>${name}</h1>
      <p>Frontend resource created with Flisk</p>
    </>
  ),
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  // The app is served under /<name>/ behind Traefik, and Vite exposes that base here.
  basepath: import.meta.env.BASE_URL,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
`,
        description: "Generating TanStack Router routes",
        emoji: "💻",
      },
    ];
  },
};
