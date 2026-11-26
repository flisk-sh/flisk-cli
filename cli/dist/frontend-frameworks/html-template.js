export function createFrontendHtmlFile(name, mountMarkup, entry) {
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
