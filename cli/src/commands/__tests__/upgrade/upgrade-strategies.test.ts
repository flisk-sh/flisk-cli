// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGACY_PACKAGE } from "../../../utils/cli-command.js";

import { createGitHubReleaseFetch, gitRebuildExecHandler, loadUpgrade, m } from "./test-support.js";

vi.doMock("node:child_process", () => m.childProcessMock);
vi.doMock("sigstore", () => m.sigstoreMock);
vi.doMock("../../../utils/tar.js", () => m.tarMock);
vi.doMock("../../../utils/which.js", () => m.whichMock);
vi.doMock("../../../utils/platform.js", (importOriginal) =>
  m.platformModuleMockFactory(importOriginal),
);

const upgrade = await loadUpgrade();

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const SIGNER =
  "https://github.com/flisk-sh/flisk-cli/.github/workflows/release-binaries.yml@refs/heads/main";

describe("package-manager upgrade failures", () => {
  it("does not switch to the GitHub default branch when npm install fails", async () => {
    m.execSyncMock.mockReset();
    const npmStderr = "npm error code EACCES: permission denied\n";
    // The legacy-package removal runs first and fails silently; the install fails and is reported.
    m.execSyncMock.mockImplementationOnce(() => {
      throw new Error(`Command failed: npm uninstall -g ${LEGACY_PACKAGE}`);
    });
    m.execSyncMock.mockImplementationOnce(() => {
      const error = new Error("Command failed: npm install -g @flisk-sh/flisk@latest");
      Object.assign(error, { stderr: Buffer.from(npmStderr) });
      throw error;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    try {
      const ok = await upgrade.upgradeViaNpm();
      expect(ok).toBe(false);
      // The legacy package owns the old `flisk` command and blocks the install, so it goes first.
      expect(String(m.execSyncMock.mock.calls[0]?.[0])).toBe(`npm uninstall -g ${LEGACY_PACKAGE}`);
      expect(String(m.execSyncMock.mock.calls[1]?.[0])).toBe(
        "npm install -g @flisk-sh/flisk@latest",
      );
      expect(m.execSyncMock.mock.calls[1]?.[1]).toMatchObject({
        stdio: ["inherit", "inherit", "pipe"],
      });
      expect(stderr).toHaveBeenCalledWith(npmStderr);
      const output = log.mock.calls.flat().map(String).join("\n");
      expect(output).toContain("npm install -g @flisk-sh/flisk@latest");
      expect(output).toContain("docs.npmjs.com");
      expect(output).not.toContain("github:");
      expect(output).not.toContain("Upgraded successfully");
    } finally {
      stderr.mockRestore();
      log.mockRestore();
    }
  });

  it("does not switch to the GitHub default branch when Bun install fails", async () => {
    m.execSyncMock.mockReset();
    m.execFileSyncMock.mockReset();
    m.execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("registry unavailable");
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const ok = await upgrade.upgradeViaBun();
      expect(ok).toBe(false);
      // The legacy package owns the old `flisk` command and blocks the install, so it goes first.
      expect(String(m.execSyncMock.mock.calls[0]?.[0])).toBe(`bun remove -g ${LEGACY_PACKAGE}`);
      expect(m.execFileSyncMock).toHaveBeenCalledTimes(1);
      expect(m.execFileSyncMock.mock.calls[0]?.[1]).toEqual([
        "install",
        "-g",
        "@flisk-sh/flisk@latest",
      ]);
      const output = log.mock.calls.flat().map(String).join("\n");
      expect(output).toContain("bun install -g @flisk-sh/flisk@latest");
      expect(output).not.toContain("github:");
      expect(output).not.toContain("Upgraded successfully");
    } finally {
      log.mockRestore();
    }
  });
});

describe("parseChecksums", () => {
  it("reads both text-mode and binary-mode (*name) shasum lines and ignores junk", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    const sums = upgrade.parseChecksums(
      `${a}  flisk-linux-amd64\n${b} *flisk-cli-engine.tar.gz\n\nnot a checksum line\n`,
    );

    expect(sums.get("flisk-linux-amd64")).toBe(a);
    expect(sums.get("flisk-cli-engine.tar.gz")).toBe("b".repeat(64));
    expect(sums.size).toBe(2);
  });

  it("skips lines missing checksum hash or file name", () => {
    const validHash = "c".repeat(64);
    const sums = upgrade.parseChecksums(
      `\n   \nshort-hash  file.tar.gz\n${validHash}\n${validHash}   \n${validHash}  valid-file.tar.gz\n`,
    );

    expect(sums.get("valid-file.tar.gz")).toBe(validHash);
    expect(sums.size).toBe(1);
  });
});

describe("Windows upgrade installation routing", () => {
  it("recognizes a compiled Windows CLI executable", () => {
    expect(upgrade.classifyRunningInstall("C:\\Users\\dev\\flisk.exe", "", "win32")).toEqual({
      method: "binary",
      path: "C:\\Users\\dev\\flisk.exe",
    });
  });

  it("recognizes an npm-installed Node entry point", () => {
    expect(
      upgrade.classifyRunningInstall(
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Users\\dev\\node_modules\\@flisk-sh\\flisk\\bin\\flisk.js",
        "win32",
      ),
    ).toEqual({
      method: "npm",
      path: "C:\\Users\\dev\\node_modules\\@flisk-sh\\flisk\\bin\\flisk.js",
    });
  });

  it("prints the npm update command instead of replacing npm files with an exe", () => {
    expect(upgrade.windowsNpmUpgradeMessage("win32", { method: "npm" })).toBe(
      "use npm install -g @flisk-sh/flisk@latest",
    );
  });
});

describe("upgradeViaGit", () => {
  let gitRepoDir: string;

  beforeEach(() => {
    gitRepoDir = mkdtempSync(join(tmpdir(), "flisk-git-test-"));
    mkdirSync(join(gitRepoDir, ".git"), { recursive: true });
    mkdirSync(join(gitRepoDir, "cli"), { recursive: true });
    writeFileSync(join(gitRepoDir, "cli", "package.json"), "{}");
    m.execFileSyncMock.mockReset();
  });

  afterEach(() => {
    rmSync(gitRepoDir, { recursive: true, force: true });
  });

  it("fails and warns when checkout is dirty", async () => {
    m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return ".git";
      if (args[0] === "fetch") return "";
      if (args[0] === "status" && args[1] === "--porcelain") return " M cli/src/foo.ts\n";
      return "";
    });

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(false);
  });

  it("fast-forwards, rebuilds and relinks when on default branch", async () => {
    m.execFileSyncMock.mockImplementation(gitRebuildExecHandler({ mode: "pull" }));

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(true);
    expect(m.execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["pull", "--ff-only", "origin", "main"],
      expect.any(Object),
    );
  });

  it("rebases feature branch onto default branch and rebuilds", async () => {
    m.execFileSyncMock.mockImplementation(
      gitRebuildExecHandler({ mode: "rebase", branch: "feature/test\n" }),
    );

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(true);
    expect(m.execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["rebase", "origin/main"],
      expect.any(Object),
    );
  });

  it("aborts rebase when rebase encounters a conflict", async () => {
    m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return ".git";
      if (args[0] === "fetch") return "";
      if (args[0] === "status" && args[1] === "--porcelain") return "";
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "feature/conflict\n";
      if (args[0] === "symbolic-ref") return "origin/main\n";
      if (args[0] === "rebase" && args[1] === "origin/main") {
        throw new Error("rebase conflict");
      }
      return "";
    });

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(false);
    expect(m.execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["rebase", "--abort"],
      expect.any(Object),
    );
  });

  it("falls back to candidate branches when symbolic-ref fails", async () => {
    m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return ".git";
      if (args[0] === "fetch") return "";
      if (args[0] === "status" && args[1] === "--porcelain") return "";
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main\n";
      if (args[0] === "symbolic-ref") throw new Error("not symbolic ref");
      if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "origin/main")
        return "hash";
      if (args[0] === "pull") return "";
      return "";
    });

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(true);
  });

  it("fails when no default branch can be determined", async () => {
    m.execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return ".git";
      if (args[0] === "fetch") return "";
      if (args[0] === "status" && args[1] === "--porcelain") return "";
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main\n";
      if (args[0] === "symbolic-ref") throw new Error("not symbolic ref");
      if (args[0] === "rev-parse" && args[1] === "--verify") throw new Error("not found");
      return "";
    });

    const ok = await upgrade.upgradeViaGit(gitRepoDir);
    expect(ok).toBe(false);
  });
});

describe("upgradeAllInstallations", () => {
  let tempDir: string;
  const origArgv1 = process.argv[1];

  beforeEach(() => {
    process.argv[1] = "";
    tempDir = mkdtempSync(join(tmpdir(), "flisk-all-test-"));
  });

  afterEach(() => {
    process.argv[1] = origArgv1;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when no installations are detected", async () => {
    m.findAllOnPathMock.mockReturnValue([]);
    m.findOnPathMock.mockReturnValue(null);

    const logErr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ok = await upgrade.upgradeAllInstallations(false);
      expect(ok).toBe(false);
    } finally {
      logErr.mockRestore();
    }
  });

  it("returns true on dry-run without performing upgrades", async () => {
    const binPath = join(tempDir, "flisk");
    writeFileSync(binPath, "ELF");
    m.findAllOnPathMock.mockReturnValue([binPath]);
    m.findOnPathMock.mockReturnValue(null);
    m.execFileSyncMock.mockReturnValue("Mach-O 64-bit arm64");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const ok = await upgrade.upgradeAllInstallations(true);
      expect(ok).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("skips updating binary when already current, and updates npm and bun", async () => {
    const binPath = join(tempDir, "flisk");
    writeFileSync(binPath, "ELF");
    const npmPath = join(tempDir, "node_modules", ".bin", "flisk");
    mkdirSync(dirname(npmPath), { recursive: true });
    writeFileSync(npmPath, "#!/bin/sh");
    m.findAllOnPathMock.mockReturnValue([binPath, npmPath]);
    m.findOnPathMock.mockReturnValue(null);
    m.execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "file") return "ELF 64-bit executable";
      if (args?.[0] === "version") return "1.4.0\n";
      return "";
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ tag_name: "v1.4.0" }),
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const ok = await upgrade.upgradeAllInstallations(false);
      expect(ok).toBe(true);
      const text = logSpy.mock.calls.flat().join(" ");
      expect(text).toContain("is already current");
      expect(text).toContain("All Flisk installations on PATH are up to date.");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("updates binary when installed version is older than latest release tag", async () => {
    const fakeBin = join(tempDir, "flisk");
    writeFileSync(fakeBin, "ELF");
    m.findAllOnPathMock.mockReturnValue([fakeBin]);
    m.findOnPathMock.mockReturnValue(null);
    m.execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "file") return "ELF 64-bit executable";
      if (args?.[0] === "version") return "1.3.0\n";
      return "";
    });

    m.sigstoreVerifyMock.mockReset();
    m.sigstoreVerifyMock.mockResolvedValue({ identity: { subjectAlternativeName: SIGNER } });
    const binarySha = sha256("fake-bin");
    const engineSha = sha256("fake-engine");
    const sumsText = `${binarySha}  flisk-darwin-arm64\n${engineSha}  flisk-cli-engine.tar.gz`;

    vi.stubGlobal(
      "fetch",
      createGitHubReleaseFetch({
        sumsText,
        includeChecksumsArrayBuffer: true,
        includeSigstoreMetadata: true,
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const ok = await upgrade.upgradeAllInstallations(false);
      expect(ok).toBe(true);
      const text = logSpy.mock.calls.flat().join(" ");
      expect(text).toContain(`Updating ${realpathSync(fakeBin)} (1.3.0 → 1.4.0)`);
      expect(text).toContain("All Flisk installations on PATH are up to date.");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("strictly matches legitimate GitHub release URLs and rejects lookalike or malicious URLs", async () => {
    const binarySha = sha256("fake-bin");
    const engineSha = sha256("fake-engine");
    const sumsText = `${binarySha}  flisk-darwin-arm64\n${engineSha}  flisk-cli-engine.tar.gz`;

    const mockFetch = createGitHubReleaseFetch({ sumsText });

    // Valid GitHub API and asset URLs must match
    const apiRes = await mockFetch("https://api.github.com/repos/flisk-sh/flisk/releases/latest");
    expect(apiRes.status).toBe(200);
    expect(await apiRes.json()).toEqual({ tag_name: "v1.4.0" });

    const sumsRes = await mockFetch(
      "https://github.com/flisk-sh/flisk/releases/download/v1.4.0/checksums.txt",
    );
    expect(sumsRes.status).toBe(200);
    expect(await sumsRes.text()).toBe(sumsText);

    // Lookalike hostnames, insecure protocols, and attacker-controlled domains must be rejected
    await expect(
      mockFetch("https://attacker-api.github.com/repos/flisk-sh/flisk/releases/latest"),
    ).rejects.toThrow("Unexpected fetch URL");
    await expect(mockFetch("https://evil.com/api.github.com/releases/latest")).rejects.toThrow(
      "Unexpected fetch URL",
    );
    await expect(
      mockFetch("http://api.github.com/repos/flisk-sh/flisk/releases/latest"),
    ).rejects.toThrow("Unexpected fetch URL");
    await expect(
      mockFetch("https://not-github.com/releases/download/v1.4.0/checksums.txt"),
    ).rejects.toThrow("Unexpected fetch URL");
  });
});
