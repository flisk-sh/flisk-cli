// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureExit, parseEnvelope } from "../../test-support/index.js";
import { ProcessExitError } from "../../utils/errors.js";
import { doctorCommand } from "../doctor.js";

// The free space is injected at the filesystem boundary, so the real doctor-host/disk-guard code decides the verdict.
const fakeDisk = vi.hoisted(() => ({ freeGib: 1.3 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statfsSync: vi.fn(() => ({
      bavail: Math.round((fakeDisk.freeGib * 1024 ** 3) / 4096),
      bsize: 4096,
    })),
  };
});

let originalCwd: string;
let platformDescriptor: PropertyDescriptor | undefined;
let projectRoot: string;

function writeService(dir: string, config: Record<string, unknown>): void {
  mkdirSync(join(projectRoot, dir), { recursive: true });
  writeFileSync(
    join(projectRoot, dir, "service.json"),
    JSON.stringify({
      $schema: "https://flisk.sh/schema.service.json",
      schemaVersion: 1,
      ...config,
    }),
  );
}

function writeLocalApi(): void {
  writeService("api", {
    appName: "local-api",
    appType: "backend",
    command: "node server.js",
    port: 41234,
  });
}

beforeEach(() => {
  originalCwd = process.cwd();
  projectRoot = mkdtempSync(join(tmpdir(), "flisk-doctor-disk-"));
  writeLocalApi();
  process.chdir(projectRoot);
  platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  fakeDisk.freeGib = 1.3;
});

afterEach(() => {
  if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
  process.chdir(originalCwd);
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  doctorCommand.setOptionValue("json", false);
  doctorCommand.setOptionValue("noPing", undefined);
  doctorCommand.setOptionValue("problemsOnly", false);
  doctorCommand.setOptionValue("all", false);
  doctorCommand.setOptionValue("strict", false);
  doctorCommand.setOptionValue("fix", false);
  doctorCommand.setOptionValue("scope", "project");
});

async function runDoctor(): Promise<ReturnType<typeof parseEnvelope>> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  captureExit();
  try {
    await doctorCommand.parseAsync(["--json", "--no-ping"], { from: "user" });
  } catch (error) {
    // captureExit turns process.exit into a throw; the JSON report has already been printed.
    if (!(error instanceof ProcessExitError)) throw error;
  }
  return parseEnvelope(String(log.mock.calls[0]?.[0]));
}

function diskCheck(report: ReturnType<typeof parseEnvelope>): Record<string, unknown> {
  const disk = report.data.checks.find((check: { name: string }) => check.name === "Disk Space") as
    | Record<string, unknown>
    | undefined;
  expect(disk).toBeDefined();
  return disk as Record<string, unknown>;
}

describe("doctor Disk Space check in a local-process project (#3706)", () => {
  it("fails with Docker cleanup guidance when a mixed run has 1.3 GiB free", async () => {
    writeService("jobs-q", {
      appName: "jobs-q",
      appType: "backend",
      image: "redis:7-alpine",
      port: 41235,
    });
    const report = await runDoctor();
    const disk = diskCheck(report);

    expect(disk).toMatchObject({ didPass: false });
    expect(disk.message).toMatch(/^1\.3 GiB free on this machine/);
    expect(disk.fix).toContain("docker builder prune -f");
    expect(report.data.ready).toBe(false);
  });

  it("warns with Docker-free guidance when a pure local run has 1.5 GiB free", async () => {
    fakeDisk.freeGib = 1.5;
    const report = await runDoctor();
    const disk = diskCheck(report);

    expect(disk).toMatchObject({ didPass: false, isWarning: true });
    expect(disk.message).toMatch(/^1\.5 GiB free on this machine/);
    expect(disk.fix).toContain("Local processes write logs");
    expect(String(disk.fix).toLowerCase()).not.toContain("docker");
  });

  it("fails with Docker-free guidance when a pure local run has 0.5 GiB free", async () => {
    fakeDisk.freeGib = 0.5;
    const report = await runDoctor();
    const disk = diskCheck(report);

    expect(disk).toMatchObject({ didPass: false });
    expect(disk.isWarning).toBeUndefined();
    expect(disk.message).toContain("needs at least 1 GiB for logs and installs");
    expect(String(disk.fix).toLowerCase()).not.toContain("docker");
    expect(report.data.ready).toBe(false);
  });

  it("passes when the machine has room", async () => {
    fakeDisk.freeGib = 40;
    const report = await runDoctor();

    expect(diskCheck(report)).toMatchObject({
      didPass: true,
      message: "40.0 GiB free on this machine",
    });
    expect(diskCheck(report).isWarning).toBeUndefined();
  });
});
