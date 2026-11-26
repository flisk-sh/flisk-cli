// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { FrontendFrameworkFile } from "./types.js";

export function createFrontendHtmlFile(
  name: string,
  mountMarkup: string,
  entry: "/src/main.ts" | "/src/main.tsx",
): FrontendFrameworkFile {
  return {
    filename: "index.html",
    content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    ${mountMarkup}
    <script type="module" src="${entry}"></script>
  </body>
</html>
`,
    description: "Generating HTML template",
    emoji: "💻",
  };
}
