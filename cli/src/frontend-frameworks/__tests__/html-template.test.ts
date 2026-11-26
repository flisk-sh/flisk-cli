// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createFrontendHtmlFile } from "../html-template.js";
import { litFrontendProvider } from "../lit.js";
import { preactFrontendProvider } from "../preact.js";
import { qwikFrontendProvider } from "../qwik.js";
import { reactFrontendProvider } from "../react.js";
import { solidFrontendProvider } from "../solid.js";
import { svelteFrontendProvider } from "../svelte.js";
import { tanstackRouterFrontendProvider } from "../tanstack-router.js";
import { vanillaFrontendProvider } from "../vanilla.js";
import { vueFrontendProvider } from "../vue.js";

const expectedHtml = (name: string, mount: string, entry: string): string => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    ${mount}
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;

describe("createFrontendHtmlFile", () => {
  it("renders the shared index.html with title, mount markup and entry", () => {
    const file = createFrontendHtmlFile("demo", '<div id="app"></div>', "/src/main.ts");

    expect(file.filename).toBe("index.html");
    expect(file.description).toBe("Generating HTML template");
    expect(file.emoji).toBe("💻");
    expect(file.content).toBe(expectedHtml("demo", '<div id="app"></div>', "/src/main.ts"));
  });

  it("supports the tsx entry", () => {
    const file = createFrontendHtmlFile("demo", '<div id="root"></div>', "/src/main.tsx");

    expect(file.content).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});

describe("provider index.html output is unchanged", () => {
  const cases = [
    ["react", reactFrontendProvider, '<div id="root"></div>', "/src/main.tsx"],
    ["vue", vueFrontendProvider, '<div id="app"></div>', "/src/main.ts"],
    ["lit", litFrontendProvider, "<app-root></app-root>", "/src/main.ts"],
    ["preact", preactFrontendProvider, '<div id="app"></div>', "/src/main.tsx"],
    ["solid", solidFrontendProvider, '<div id="app"></div>', "/src/main.tsx"],
    ["qwik", qwikFrontendProvider, '<div id="app"></div>', "/src/main.tsx"],
    ["svelte", svelteFrontendProvider, '<div id="app"></div>', "/src/main.ts"],
    ["tanstack-router", tanstackRouterFrontendProvider, '<div id="root"></div>', "/src/main.tsx"],
    ["vanilla", vanillaFrontendProvider, '<div id="app"></div>', "/src/main.ts"],
  ] as const;

  it.each(cases)(
    "%s emits the byte-identical HTML it emitted before the refactor",
    (_id, provider, mount, entry) => {
      const [first] = provider.createFiles("my-app");

      expect(first).toEqual({
        filename: "index.html",
        content: expectedHtml("my-app", mount, entry),
        description: "Generating HTML template",
        emoji: "💻",
      });
    },
  );
});
