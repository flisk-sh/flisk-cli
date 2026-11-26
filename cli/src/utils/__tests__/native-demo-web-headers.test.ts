// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The demo website without Docker is a plain Node script, started here for real on a free port. The nightly OWASP ZAP scan
// (.github/workflows-disabled/zap.yml) fails on missing security headers, so this test keeps them in place on every pull request.
const serverPath = fileURLToPath(
  new URL("../../../templates/demo-native/web/server.mjs", import.meta.url),
);
const pagePath = fileURLToPath(
  new URL("../../../templates/demo-native/web/index.html", import.meta.url),
);

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startWebsite(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), API_URL: "http://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) resolve();
    });
  });
  return child;
}

function inlineHash(page: string, tag: string): string {
  const body = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(page)?.[1] ?? "";
  return `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
}

describe("demo website security headers", () => {
  let child: ChildProcess | undefined;
  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it("sets the headers on the page, /health and a failed /api call", async () => {
    const port = await freePort();
    child = await startWebsite(port);
    for (const path of ["/", "/health", "/api/menu"]) {
      const reply = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(reply.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(reply.headers.get("x-frame-options"), path).toBe("DENY");
      expect(reply.headers.get("cross-origin-opener-policy"), path).toBe("same-origin");
      expect(reply.headers.get("cross-origin-embedder-policy"), path).toBe("require-corp");
      expect(reply.headers.get("permissions-policy"), path).toContain("camera=()");
      expect(reply.headers.get("cache-control"), path).toBe("no-store");
      expect(reply.headers.get("content-security-policy"), path).toContain(
        "frame-ancestors 'none'",
      );
      await reply.arrayBuffer();
    }
  });

  it("allows the page's inline script and style by hash, never unsafe-inline", async () => {
    const port = await freePort();
    child = await startWebsite(port);
    const page = readFileSync(pagePath, "utf-8");
    const csp =
      (await fetch(`http://127.0.0.1:${port}/`)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`script-src ${inlineHash(page, "script")}`);
    expect(csp).toContain(`style-src ${inlineHash(page, "style")}`);
    expect(csp).not.toContain("unsafe-inline");
  });

  it("keeps style attributes out of the page, which the policy would block", () => {
    expect(readFileSync(pagePath, "utf-8")).not.toMatch(/style="/);
  });
});
