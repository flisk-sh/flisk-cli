// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  loadUpgradeWithMocks,
  m,
  setupUpgradeCommandTests,
  stubFetchLatestRelease,
  stubFetchLatestThenAssetFailure,
  stubFetchReleaseNotFound,
} from "./test-support.js";

const upgrade = await loadUpgradeWithMocks();

describe("upgradeCommand action handler", () => {
  const { getTmp, runUpgrade } = setupUpgradeCommandTests(upgrade);

  describe("--all flag", () => {
    it("exits with 1 when no installations are found", async () => {
      m.findOnPathMock.mockReturnValue(null);
      m.findAllOnPathMock.mockReturnValue([]);

      const res = await runUpgrade(["--all"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Could not find any Flisk installations on PATH.");
    });

    it("exits with 0 when confirmation prompt is cancelled", async () => {
      const fakeBin = join(getTmp(), "flisk");
      writeFileSync(fakeBin, "ELF");
      m.findAllOnPathMock.mockReturnValue([fakeBin]);
      m.findOnPathMock.mockReturnValue(null);
      m.execFileSyncMock.mockReturnValue("Mach-O 64-bit arm64");
      m.promptConfirmMock.mockResolvedValueOnce(false);

      const res = await runUpgrade(["--all"]);
      expect(res.status).toBe(0);
    });

    it("runs dry run successfully with --all --dry-run", async () => {
      const fakeBin = join(getTmp(), "flisk");
      writeFileSync(fakeBin, "ELF");
      m.findAllOnPathMock.mockReturnValue([fakeBin]);
      m.findOnPathMock.mockReturnValue(null);
      m.execFileSyncMock.mockReturnValue("Mach-O 64-bit arm64");

      const res = await runUpgrade(["--all", "--dry-run"]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain("Dry run: no installations were changed.");
    });
  });

  describe("unknown install method", () => {
    it("logs manual instructions and exits with 1", async () => {
      m.findOnPathMock.mockReturnValue(null);

      const res = await runUpgrade([]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Could not detect installation method");
      expect(res.stdout).toContain("npm install -g @flisk-sh/flisk@latest");
    });
  });

  describe("Windows npm upgrade message", () => {
    it("prints message and returns without exiting when on Windows with npm install", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const npmPath = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmPath), { recursive: true });
      writeFileSync(npmPath, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmPath);
      m.platformMock.isWindows.mockReturnValue(true);

      const res = await runUpgrade([]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain("use npm install -g @flisk-sh/flisk@latest");
    });
  });

  describe("binary upgrade flow", () => {
    let fakeBin: string;

    beforeEach(() => {
      fakeBin = join(getTmp(), "flisk");
      writeFileSync(fakeBin, "ELF");
      m.findOnPathMock.mockReturnValue(fakeBin);
      Object.defineProperty(process, "execPath", { value: fakeBin, configurable: true });
      m.execFileSyncMock.mockReturnValue("ELF 64-bit executable");
    });

    it("exits with 0 when already on the latest version and --force is not passed", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.186");
      stubFetchLatestRelease("v1.3.186");

      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("You are already on the latest version!");
      expect(res.stdout).toContain("1.3.186 (current) = 1.3.186 (latest)");
    });

    it("shows upgrade available and prompts when installed version is older than latest binary release", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestRelease("v1.4.0");
      m.promptConfirmMock.mockResolvedValueOnce(false);

      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Upgrade available: 1.3.0 → 1.4.0");
      expect(res.stdout).toContain("Cancelled.");
    });

    it("shows upgrade available and performs dry run when installed version is older than latest binary release", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestRelease("v1.4.0");

      const res = await runUpgrade(["--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Upgrade available: 1.3.0 → 1.4.0");
      expect(res.stdout).toContain("Dry run mode - would perform:");
      expect(res.stdout).toContain("Method: binary");
      expect(res.stdout).toContain(`Path: ${fakeBin}`);
      expect(res.stdout).toContain("Action: Download and replace with");
      expect(res.stdout).toContain("Action: Refresh bundled engine from");
    });

    it("normalizes leading v in release tag and handles boundary version comparison", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestRelease("v2.0.0-beta.1");
      m.promptConfirmMock.mockResolvedValueOnce(false);

      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Upgrade available: 1.3.0 → 2.0.0");
    });

    it("shows force upgrade requested when already on latest and --force is passed with --dry-run", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.186");
      stubFetchLatestRelease("v1.3.186");

      const res = await runUpgrade(["--force", "--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Force upgrade requested (currently 1.3.186)");
      expect(res.stdout).toContain("Dry run mode - would perform:");
      expect(res.stdout).toContain("Action: Download and replace with");
    });

    it("exits with 1 when binary release cannot be found", async () => {
      stubFetchReleaseNotFound();

      const res = await runUpgrade([]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unsupported OS");
    });

    it("exits with 1 with Windows ARM64 specific error when on win32 arm64 and binary release missing", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
      stubFetchReleaseNotFound();

      const res = await runUpgrade([]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Flisk Windows v1 supports AMD64 only");
    });

    it("exits with 1 with Windows AMD64 specific error when on win32 x64 and binary release missing", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      Object.defineProperty(process, "arch", { value: "x64", configurable: true });
      stubFetchReleaseNotFound();

      const res = await runUpgrade([]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("No Windows AMD64 binary in this Flisk release");
    });

    it("exits with 1 and shows manual curl instructions when binary upgrade fails", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestThenAssetFailure();

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Upgrade failed");
      expect(res.stdout).toContain("curl -fsSL -o");
    });

    it("shows Windows PowerShell instructions when binary upgrade fails on Windows", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      m.platformMock.isWindows.mockReturnValue(true);
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestThenAssetFailure();

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Upgrade failed");
      expect(res.stdout).toContain("irm https://flisk.sh/install.ps1 | iex");
    });
  });
});
