// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectUpgradeJsonEnvelope,
  gitUpgradeExecHandler,
  loadUpgradeWithMocks,
  m,
  setupUpgradeCommandTests,
  stubFetchLatestRelease,
} from "./test-support.js";

const upgrade = await loadUpgradeWithMocks();

describe("upgradeCommand action handler", () => {
  const { getTmp, runUpgrade } = setupUpgradeCommandTests(upgrade);

  describe("git upgrade flow", () => {
    let gitDir: string;
    let fakeBin: string;

    beforeEach(() => {
      gitDir = join(getTmp(), "my-repo");
      const binDir = join(gitDir, "flisk-cli", "bin");
      mkdirSync(join(gitDir, ".git"), { recursive: true });
      mkdirSync(binDir, { recursive: true });
      fakeBin = join(binDir, "flisk");
      writeFileSync(fakeBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(fakeBin);
    });

    it("exits with 0 when local commit matches remote and --force is not passed", async () => {
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") return "";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abcdef1234567\n";
        if (args[0] === "rev-parse" && args[1] === "origin/main") return "abcdef1234567\n";
        return "";
      });

      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Already up to date with origin/main!");
    });

    it("shows force upgrade requested when local commit matches remote and --force is passed with --dry-run", async () => {
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") return "";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "abcdef1234567\n";
        if (args[0] === "rev-parse" && args[1] === "origin/main") return "abcdef1234567\n";
        return "";
      });

      const res = await runUpgrade(["--force", "--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Force upgrade requested");
      expect(res.stdout).toContain("Dry run mode - would perform:");
    });

    it("shows updates available and performs dry run", async () => {
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") return "";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "aaaaaaa111111\n";
        if (args[0] === "rev-parse" && args[1] === "origin/main") return "bbbbbbb222222\n";
        return "";
      });

      const res = await runUpgrade(["--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Updates available:");
      expect(res.stdout).toContain("Action: fetch origin, update from origin/HEAD");
    });

    it("warns and continues when git remote check fails", async () => {
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") throw new Error("remote offline");
        return "";
      });

      const res = await runUpgrade(["--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("Could not check git remote, will attempt upgrade anyway");
      expect(res.stdout).toContain("Action: fetch origin, update from origin/HEAD");
    });

    it("exits with 1 and shows git status instructions when git upgrade fails", async () => {
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") return "";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "aaaaaaa111111\n";
        if (args[0] === "rev-parse" && args[1] === "origin/main") return "bbbbbbb222222\n";
        if (args[0] === "status" && args[1] === "--porcelain") return " M cli/src/foo.ts";
        return "";
      });

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Upgrade failed");
      expect(res.stdout).toContain("Check local changes with: git -C");
    });

    it("successfully upgrades git install and displays git clone details in verification", async () => {
      m.execFileSyncMock.mockImplementation(gitUpgradeExecHandler());

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain("Method:   git clone + bun link");
      expect(res.stdout).toContain("Upgrade complete!");
    });

    it("displays git-specific verify hint when verification fails after git upgrade", async () => {
      m.execFileSyncMock.mockImplementation(
        gitUpgradeExecHandler({ versionError: new Error("corrupt executable") }),
      );

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stderr).toContain("Verification error");
      expect(res.stdout).toContain("Compare with: git -C");
    });
  });

  describe("package manager (npm/bun) flow", () => {
    let npmBin: string;

    beforeEach(() => {
      npmBin = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmBin);
    });

    it("prints manual install hints and exits with 1 when the registry request fails", async () => {
      m.npmViewMock.mockImplementation(() => {
        throw new Error("npm error: registry unavailable");
      });

      const res = await runUpgrade(["--dry-run"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Could not determine latest version");
      expect(res.stdout).toContain("Install the latest published release manually");
      expect(res.stdout).toContain("bun install -g @flisk-sh/flisk@latest");
      expect(res.stderr).not.toContain("command not found");
      expect(m.execSyncMock).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("exits with 0 when already on the latest version and --force is not passed", async () => {
      m.getPackageVersionMock.mockReturnValue("1.4.0");
      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("You are already on the latest version!");
    });

    it("exits with 0 when user declines confirmation prompt", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.promptConfirmMock.mockResolvedValueOnce(false);

      const res = await runUpgrade([]);
      expect(res.status).toBe(0);
    });

    it("shows force upgrade requested when already on latest and --force is passed with --dry-run", async () => {
      m.getPackageVersionMock.mockReturnValue("1.4.0");
      const res = await runUpgrade(["--force", "--dry-run"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Force upgrade requested (currently 1.4.0)");
      expect(res.stdout).toContain("Dry run mode - would perform:");
      expect(res.stdout).toContain("Action: Upgrade to 1.4.0");
    });

    it("successfully upgrades and verifies new version", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.execFileSyncMock.mockReturnValue("1.4.0\n");

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain("Upgrade complete!");
      expect(res.stdout).toContain("Version: 1.3.0 → 1.4.0");
      expect(res.stdout).toContain("flisk --help");
    });

    it("shows restart warning when version appears unchanged after upgrade without --force", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.execFileSyncMock.mockReturnValue("1.3.0\n");

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain(
        "Tip: Version appears unchanged. You may need to restart your terminal.",
      );
    });

    it("handles verification failure with permission error", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args?.[0] === "version") {
          const err = new Error("Permission denied");
          Object.assign(err, { code: "EACCES" });
          throw err;
        }
        return "";
      });

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stderr).toContain("Verification error");
      expect(res.stdout).toContain("chmod +x");
    });

    it("handles verification failure with generic error", async () => {
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args?.[0] === "version") {
          throw new Error("spawn error");
        }
        return "";
      });

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stderr).toContain("Verification error");
      expect(res.stdout).toContain("Verify manually:");
    });

    it("successfully upgrades bun installation", async () => {
      const bunPath = join(getTmp(), ".bun", "bin", "flisk");
      mkdirSync(dirname(bunPath), { recursive: true });
      writeFileSync(bunPath, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(bunPath);
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      m.execFileSyncMock.mockReturnValue("1.4.0\n");

      const res = await runUpgrade(["--yes"]);
      expect(res.status).toBeUndefined();
      expect(res.stdout).toContain("Upgrade complete!");
    });
  });

  describe("configured npm registry lookup", () => {
    beforeEach(() => {
      const bin = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(bin), { recursive: true });
      writeFileSync(bin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(bin);
    });

    it("uses the version returned by npm with the scoped registry config", async () => {
      m.npmViewMock.mockReturnValue("1.5.2\n");

      const res = await runUpgrade(["--dry-run", "--json"]);

      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expect(JSON.parse(res.stdout).data.latestVersion).toBe("1.5.2");
      expect(m.npmViewMock).toHaveBeenCalledWith(
        ["view", "@flisk-sh/flisk", "version"],
        expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }),
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it("reports an npm lookup failure without retrying the public registry", async () => {
      vi.stubEnv("FLISK_VERBOSE", "1");
      m.npmViewMock.mockImplementation(() => {
        throw Object.assign(new Error("Command failed\nnpm error E401"), { status: 1 });
      });

      const res = await runUpgrade(["--dry-run", "--json"]);

      expect(res.status).toBe(1);
      expect(JSON.parse(res.stdout).errors[0].message).toBe("Could not determine latest version");
      expect(res.stderr).not.toContain("npm error E401");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("Bun-only registry lookup", () => {
    let bunBin: string;

    beforeEach(() => {
      bunBin = join(getTmp(), ".bun", "bin", "flisk");
      mkdirSync(dirname(bunBin), { recursive: true });
      writeFileSync(bunBin, "#!/bin/sh");
      vi.stubEnv("PATH", dirname(bunBin));
      m.findOnPathMock.mockImplementation((command) => (command === "flisk" ? bunBin : null));
      m.npmViewMock.mockImplementation(() => {
        throw Object.assign(new Error("spawnSync npm ENOENT"), { code: "ENOENT" });
      });
    });

    it("resolves the latest version on --dry-run without npm on PATH", async () => {
      const res = await runUpgrade(["--dry-run"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Upgrade available: 1.3.186 → 1.4.0");
      expect(res.stderr).toBe("");
      expect(fetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/@flisk-sh%2fflisk/latest",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(m.npmViewMock).toHaveBeenCalledOnce();
      expect(m.execSyncMock).not.toHaveBeenCalled();
    });

    it("returns a successful JSON envelope without npm on PATH", async () => {
      const res = await runUpgrade(["--dry-run", "--json"]);

      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expect(JSON.parse(res.stdout)).toEqual({
        schemaVersion: 1,
        data: {
          dryRun: true,
          currentVersion: "1.3.186",
          latestVersion: "1.4.0",
          upgradeAvailable: true,
          method: "bun",
          path: bunBin,
          installations: [{ method: "bun", path: bunBin }],
        },
        errors: [],
      });
      expect(m.execSyncMock).not.toHaveBeenCalled();
    });

    it("reports a failed registry request in the JSON envelope with a Bun install hint", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
      const res = await runUpgrade(["--dry-run", "--json"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toBe("Could not determine latest version\n");
      expect(JSON.parse(res.stdout)).toEqual({
        schemaVersion: 1,
        data: null,
        errors: [
          expect.objectContaining({
            code: "COMMAND_FAILED",
            message: "Could not determine latest version",
            suggestions: expect.arrayContaining([
              expect.stringContaining("npm registry access"),
              expect.stringContaining("bun install -g @flisk-sh/flisk@latest"),
            ]),
          }),
        ],
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(m.execSyncMock).not.toHaveBeenCalled();
    });
  });

  describe("--json flag (#4262)", () => {
    it("exits 0 and emits a versioned JSON envelope with current and latest versions on --dry-run --json", async () => {
      const npmBin = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmBin);
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expectUpgradeJsonEnvelope(JSON.parse(res.stdout), {
        currentVersion: "1.3.0",
        latestVersion: "1.4.0",
        upgradeAvailable: true,
        method: "npm",
        path: npmBin,
        installations: [{ method: "npm", path: npmBin }],
      });
    });

    it("emits upgradeAvailable: false when already on the latest version with --dry-run --json", async () => {
      const npmBin = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmBin);
      m.getPackageVersionMock.mockReturnValue("1.4.0");
      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(0);
      expectUpgradeJsonEnvelope(JSON.parse(res.stdout), {
        currentVersion: "1.4.0",
        latestVersion: "1.4.0",
        upgradeAvailable: false,
        method: "npm",
        path: npmBin,
        installations: [{ method: "npm", path: npmBin }],
      });
    });

    it("reports binary release versions in --dry-run --json", async () => {
      const fakeBin = realpathSync(getTmp());
      const binaryPath = join(fakeBin, "flisk");
      writeFileSync(binaryPath, "ELF");
      m.findOnPathMock.mockReturnValue(binaryPath);
      Object.defineProperty(process, "execPath", { value: binaryPath, configurable: true });
      m.execFileSyncMock.mockReturnValue("ELF 64-bit executable");
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      stubFetchLatestRelease("v1.4.0");

      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(0);
      expectUpgradeJsonEnvelope(JSON.parse(res.stdout), {
        currentVersion: "1.3.0",
        latestVersion: "1.4.0",
        upgradeAvailable: true,
        method: "binary",
        path: binaryPath,
        installations: [{ method: "binary", path: binaryPath }],
      });
    });

    it("lists every installation found on PATH when --dry-run --json --all is passed", async () => {
      const npmBin = join(getTmp(), "node_modules", ".bin", "flisk");
      const bunBin = join(getTmp(), ".bun", "bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      mkdirSync(dirname(bunBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      writeFileSync(bunBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmBin);
      m.findAllOnPathMock.mockReturnValue([npmBin, bunBin]);
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      const res = await runUpgrade(["--dry-run", "--json", "--all"]);
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expectUpgradeJsonEnvelope(JSON.parse(res.stdout), {
        currentVersion: "1.3.0",
        latestVersion: "1.4.0",
        upgradeAvailable: true,
        method: "npm",
        path: npmBin,
        installations: [
          { method: "npm", path: npmBin },
          { method: "bun", path: bunBin },
        ],
      });
    });

    function setupGitCheckout(): string {
      const gitDir = join(getTmp(), "json-repo");
      const binDir = join(gitDir, "flisk-cli", "bin");
      mkdirSync(join(gitDir, ".git"), { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const bin = join(binDir, "flisk");
      writeFileSync(bin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(bin);
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      return bin;
    }

    it("reports a release lookup failure, not an unsupported OS, on a supported platform", async () => {
      const binaryPath = join(realpathSync(getTmp()), "flisk");
      writeFileSync(binaryPath, "ELF");
      m.findOnPathMock.mockReturnValue(binaryPath);
      Object.defineProperty(process, "execPath", { value: binaryPath, configurable: true });
      m.execFileSyncMock.mockReturnValue("ELF 64-bit executable");
      m.getPackageVersionMock.mockReturnValue("1.3.0");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(1);
      const envelope = JSON.parse(res.stdout);
      expect(envelope.data).toBeNull();
      expect(envelope.errors[0].message).toContain(
        "Could not look up the latest Flisk binary release",
      );
      expect(envelope.errors[0].message).not.toContain("Unsupported OS");
      expect(envelope.errors[0].suggestions.join(" ")).toContain("retry");
    });

    it("compares against origin/master when origin/main does not exist in --dry-run --json", async () => {
      setupGitCheckout();
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "symbolic-ref") return "origin/master\n";
        if (args[0] === "rev-parse" && args[1] === "HEAD") return "aaaaaaa1111111\n";
        if (args[0] === "rev-parse" && args[1] === "origin/master") return "bbbbbbb2222222\n";
        if (args[0] === "rev-parse" && args[1] === "origin/main") {
          throw new Error("fatal: ambiguous argument 'origin/main'");
        }
        return "";
      });

      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(0);
      const envelope = JSON.parse(res.stdout);
      expect(envelope.data).toMatchObject({
        method: "git",
        latestVersion: "bbbbbbb",
        upgradeAvailable: true,
      });
    });

    it("exits 1 with an error envelope when git fetch fails in --dry-run --json", async () => {
      setupGitCheckout();
      m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "fetch") throw new Error("fatal: unable to access remote");
        return "";
      });

      const res = await runUpgrade(["--dry-run", "--json"]);
      expect(res.status).toBe(1);
      const envelope = JSON.parse(res.stdout);
      expect(envelope.data).toBeNull();
      expect(envelope.errors[0].message).toContain("Could not check the git installation");
    });

    it("refuses --json without --dry-run using an error envelope that names --dry-run", async () => {
      const npmBin = join(getTmp(), "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValue(npmBin);
      m.getPackageVersionMock.mockReturnValue("1.3.0");

      const res = await runUpgrade(["--json", "--yes"]);
      expect(res.status).toBe(1);
      expect(m.execSyncMock).not.toHaveBeenCalled();
      expect(m.npmViewMock).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      const envelope = JSON.parse(res.stdout);
      expect(envelope).toEqual({
        schemaVersion: 1,
        data: null,
        errors: [
          expect.objectContaining({
            code: "COMMAND_FAILED",
            message: expect.stringContaining("--dry-run"),
            suggestions: expect.arrayContaining([expect.stringContaining("--dry-run")]),
          }),
        ],
      });
    });
  });
});
