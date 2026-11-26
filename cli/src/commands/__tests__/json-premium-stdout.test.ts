// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanEnv, fliskBin } from "../../test-support/index.js";

function runFliskAsync(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [fliskBin, ...args], {
      cwd: options.cwd,
      env: cleanEnv({ NO_COLOR: "1", ...options.env }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TAR_BLOCK_SIZE = 512;

function tarHeader(entryPath: string, size: number, isDirectory: boolean): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  header.write(entryPath, 0, 100, "utf-8");
  const mode = isDirectory ? 0o755 : 0o644;
  header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write(`${(1_700_000_000).toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii");
  header.write(isDirectory ? "5" : "0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "utf-8");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function buildOverlayTarGz(): Buffer {
  const entries = [
    { path: "./" },
    { path: "./typescript/" },
    {
      path: "./typescript/playwright_config.star",
      content: "# licensed playwright overlay fixture\ndef generate_playwright_config(): pass\n",
    },
    { path: "./c4_diagram.star", content: "# licensed c4 fixture\n" },
  ];
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const isDirectory = entry.content === undefined;
    const content = Buffer.from(entry.content ?? "", "utf-8");
    blocks.push(tarHeader(entry.path, isDirectory ? 0 : content.byteLength, isDirectory));
    if (isDirectory) continue;
    blocks.push(content);
    const pad = (TAR_BLOCK_SIZE - (content.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return gzipSync(Buffer.concat(blocks));
}

describe("JSON commands with a configured license key (#5496)", () => {
  const dirs: string[] = [];
  let server: Server;
  let endpoint: string;
  const bundle = buildOverlayTarGz();

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/gzip" });
      res.end(bundle);
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Failed to bind mock premium server");
    endpoint = `http://127.0.0.1:${addr.port}/v1/premium/bundle.tar.gz`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function createLicensedEnv(homeDir: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      FLISK_LICENSE_KEY: "flisk-test-key-json-stdout",
      FLISK_PREMIUM_ENDPOINT: endpoint,
      FLISK_EXTENSION_SOURCE: repoRoot,
    };
  }

  function expectStrictJsonStdout(stdout: string, stderr = ""): Record<string, unknown> {
    expect(stdout, `stdout=${stdout}\nstderr=${stderr}`).not.toContain(
      "Premium resources unlocked",
    );
    expect(stdout).not.toContain("entitlement probe");
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  it.each(["0", "1"])(
    "keeps project, resource, regenerate, and --ddd --json stdout strictly valid JSON (diagnostics=%s)",
    async (diagnostics) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "flisk-json-premium-proj-")));
      const home = realpathSync(mkdtempSync(join(tmpdir(), "flisk-json-premium-home-")));
      dirs.push(root, home);

      const env: NodeJS.ProcessEnv = {
        ...createLicensedEnv(home),
        FLISK_PREMIUM_DIAGNOSTICS: diagnostics,
      };

      const proj = await runFliskAsync(["project", "--yes", "--json"], { cwd: root, env });
      expect(proj.status, proj.stderr).toBe(0);
      const projJson = expectStrictJsonStdout(proj.stdout, proj.stderr);
      expect(projJson.errors).toEqual([]);

      const overlaidFile = join(
        root,
        ".flisk",
        ".flisk-out",
        "flisk-cli-ext",
        "engine",
        "topologies",
        "tilt",
        "generators",
        "typescript",
        "playwright_config.star",
      );
      expect(existsSync(overlaidFile)).toBe(true);
      expect(readFileSync(overlaidFile, "utf8")).toContain("# licensed playwright overlay fixture");

      mkdirSync(join(root, "services", "main", "q1"), { recursive: true });
      writeFileSync(join(root, "services", "main", "q1", "Dockerfile"), "FROM alpine:3.20\n");
      const byo = await runFliskAsync(
        [
          "resource",
          "q1",
          "--type",
          "bring-your-own",
          "--stack",
          "main",
          "--json",
          "--dockerfile",
          "Dockerfile",
        ],
        { cwd: root, env },
      );
      expect(byo.status, byo.stderr).toBe(0);
      const byoJson = expectStrictJsonStdout(byo.stdout, byo.stderr);
      expect(byoJson.errors).toEqual([]);

      const ddd = await runFliskAsync(
        ["resource", "api", "--type", "backend", "--stack", "main", "--ddd", "--json"],
        { cwd: root, env },
      );
      expect(ddd.status, ddd.stderr).toBe(0);
      const dddJson = expectStrictJsonStdout(ddd.stdout, ddd.stderr);
      expect(dddJson.errors).toEqual([]);

      const regen = await runFliskAsync(["config", "regenerate", "--json"], { cwd: root, env });
      expect(regen.status, regen.stderr).toBe(0);
      const regenJson = expectStrictJsonStdout(regen.stdout, regen.stderr);
      expect(regenJson.errors).toEqual([]);
    },
  );
});
