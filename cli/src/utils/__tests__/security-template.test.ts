// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "../../test-support/index.js";
import { securityManifests, writeSecurityProject } from "../security-template.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `/health` until the service answers 2xx (used so tests never scan before all agents are up). */
async function waitHealth(url: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`service at ${url} did not become healthy`);
    await sleep(50);
  }
}

const SCAN_BODY = {
  files: { "a.js": 'const x = "http://example.com";\nconst apiKey = "abcdef123456";' },
};

/** Spawn one agent of the security starter. Returns the process; `extra` is merged into its env. */
function spawnAgent(
  dir: string,
  name: string,
  port: number,
  extra: Record<string, string> = {},
): ChildProcess {
  return spawn("node", [join(dir, name, "server.mjs")], {
    env: { ...process.env, PORT: String(port), ...extra },
  });
}

describe("security template", () => {
  it("chains scanner to triage to reporter as local processes", () => {
    const manifests = securityManifests();
    expect(manifests["scanner/service.json"]?.dependsOn).toEqual(["triage"]);
    expect(manifests["triage/service.json"]?.dependsOn).toEqual(["reporter"]);
    for (const manifest of Object.values(manifests)) expect(manifest.command).toBeTruthy();
  });

  it("writes the project to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "security-"));
    dirs.push(dir);
    writeSecurityProject(dir);
    for (const file of [
      "README.md",
      "scanner/server.mjs",
      "scanner/forward.mjs",
      "triage/server.mjs",
      "triage/forward.mjs",
      "reporter/server.mjs",
      "reporter/service.json",
    ]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
  });

  it("reports a hardcoded secret as critical, worst first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "security-"));
    dirs.push(dir);
    writeSecurityProject(dir);
    const ports = [await freePort(), await freePort(), await freePort()];
    const url = (n: number) => `http://localhost:${ports[n]}`;
    const procs = [
      spawnAgent(dir, "reporter", ports[2]),
      spawnAgent(dir, "triage", ports[1], { REPORTER_URL: url(2) }),
      spawnAgent(dir, "scanner", ports[0], { TRIAGE_URL: url(1) }),
    ];
    try {
      // wait for all three agents to be healthy before scanning, so the
      // fire-and-forget window between processes cannot flake the test
      await waitHealth(url(0));
      await waitHealth(url(1));
      await waitHealth(url(2));
      const scanned = await fetch(`${url(0)}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SCAN_BODY),
      });
      expect(scanned.status).toBe(200);
      let report: { total: number; findings: { severity: string }[] } = { total: 0, findings: [] };
      for (let i = 0; i < 100 && report.total < 2; i++) {
        await sleep(100);
        report = await (await fetch(`${url(2)}/report`)).json();
      }
      expect(report.findings.map((f) => f.severity)).toEqual(["critical", "medium"]);
    } finally {
      for (const proc of procs) proc.kill();
    }
  }, 30_000);

  it("answers 502 and logs when triage is down instead of dropping findings silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "security-"));
    dirs.push(dir);
    writeSecurityProject(dir);
    const [scannerPort, deadPort] = [await freePort(), await freePort()];
    const scannerUrl = `http://localhost:${scannerPort}`;
    const proc = spawnAgent(dir, "scanner", scannerPort, {
      TRIAGE_URL: `http://localhost:${deadPort}`,
      FORWARD_TRIES: "2",
      FORWARD_DELAY_MS: "20",
    });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += d));
    try {
      await waitHealth(scannerUrl);
      const res = await fetch(`${scannerUrl}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: { "a.js": 'const apiKey = "abcdef123456";' } }),
      });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "triage unavailable" });
      await sleep(100);
      expect(stderr).toMatch(/triage unavailable/);
    } finally {
      proc.kill();
    }
  }, 30_000);

  it("delivers findings when triage starts while the scanner is still retrying", async () => {
    const dir = mkdtempSync(join(tmpdir(), "security-"));
    dirs.push(dir);
    writeSecurityProject(dir);
    const [scannerPort, triagePort, reporterPort] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const url = (p: number) => `http://localhost:${p}`;
    const scanner = spawnAgent(dir, "scanner", scannerPort, {
      TRIAGE_URL: url(triagePort),
      FORWARD_TRIES: "100",
      FORWARD_DELAY_MS: "50",
    });
    const reporter = spawnAgent(dir, "reporter", reporterPort);
    let triage: ChildProcess | undefined;
    try {
      await waitHealth(url(scannerPort));
      await waitHealth(url(reporterPort));
      // triage is NOT up yet: the scanner must retry instead of losing the findings
      const scanPromise = fetch(`${url(scannerPort)}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SCAN_BODY),
      });
      await sleep(300); // scanner is mid-retry now
      triage = spawnAgent(dir, "triage", triagePort, { REPORTER_URL: url(reporterPort) });
      const scan = await scanPromise;
      expect(scan.status).toBe(200);
      let report: { total: number; findings: { severity: string }[] } = { total: 0, findings: [] };
      for (let i = 0; i < 100 && report.total < 2; i++) {
        await sleep(100);
        report = await (await fetch(`${url(reporterPort)}/report`)).json();
      }
      expect(report.findings.map((f) => f.severity)).toEqual(["critical", "medium"]);
    } finally {
      scanner.kill();
      triage?.kill();
      reporter.kill();
    }
  }, 30_000);
});
