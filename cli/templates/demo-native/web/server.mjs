// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The website of the Flisk demo without Docker. It serves index.html and forwards /api/* to the menu API at API_URL.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, request as forward } from "node:http";

const page = readFileSync(new URL("./index.html", import.meta.url), "utf-8");

// The page's one inline <style> and <script> are allowed by hash, so the policy needs no 'unsafe-inline'.
const hash = (tag) => {
  const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(page)?.[1] ?? "";
  return `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
};
const securityHeaders = {
  "content-security-policy": `default-src 'none'; script-src ${hash("script")}; style-src ${hash("style")}; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
};
const api = new URL(process.env.API_URL ?? "http://localhost:4000");

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { ...securityHeaders, "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  // Same-origin /api/ only: "//evil.com" cannot change the host, and ".." or "%2e" never pass. A target that
  // does not parse (such as "//") gets the page.
  let apiPath = null;
  try {
    const parsed = new URL(request.url ?? "/", "https://web.invalid");
    if (parsed.host === "web.invalid" && /^\/api\/(?!.*(\.\.|%2e))/i.test(parsed.pathname)) {
      // Rebuild the path from checked segments only, never from the raw request target.
      const segments = parsed.pathname.split("/").filter((segment) => /^[\w.~%-]+$/.test(segment));
      const query = parsed.search.replace(/[^\w=&%.~+,-]/g, "").replace(/^(?!$)/, "?");
      apiPath = `/${segments.join("/")}${query}`;
    }
  } catch {}
  if (apiPath) {
    const upstream = forward(
      { host: api.hostname, port: api.port, path: apiPath, method: request.method },
      (reply) => {
        // Copy only plain header names and drop redirects: the API can never send the browser to another site.
        const headers = new Map();
        for (const [name, value] of Object.entries(reply.headers)) {
          if (/^[a-z][\w-]*$/.test(name) && name !== "location" && value !== undefined)
            headers.set(name, value);
        }
        response.writeHead(reply.statusCode ?? 502, {
          ...Object.fromEntries(headers),
          ...securityHeaders,
        });
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502, { ...securityHeaders, "content-type": "application/json" });
      response.end(JSON.stringify({ error: "the menu API is not answering" }));
    });
    request.pipe(upstream);
    return;
  }
  response.writeHead(200, { ...securityHeaders, "content-type": "text/html; charset=utf-8" });
  response.end(page);
});

server.listen(Number(process.env.PORT), () => {
  console.log(`website listening on http://localhost:${process.env.PORT}`);
});
