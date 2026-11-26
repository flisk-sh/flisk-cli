// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

import { tmpdir } from "node:os";

import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadUpgrade, m } from "./test-support.js";

vi.doMock("node:child_process", () => m.childProcessMock);
vi.doMock("../../../utils/which.js", () => m.whichMock);
vi.doMock("../../../utils/paths.js", (importOriginal) => m.pathsMockFactory(importOriginal));
vi.doMock("../../../utils/platform.js", (importOriginal) =>
  m.platformModuleMockFactory(importOriginal),
);

const upgrade = await loadUpgrade();

describe("isPermissionError", () => {
  it("returns true for EACCES and EPERM errors", () => {
    expect(upgrade.isPermissionError({ code: "EACCES" })).toBe(true);
    expect(upgrade.isPermissionError({ code: "EPERM" })).toBe(true);
  });

  it("returns false for other codes or non-objects", () => {
    expect(upgrade.isPermissionError({ code: "ENOENT" })).toBe(false);
    expect(upgrade.isPermissionError(new Error("Generic"))).toBe(false);
    expect(upgrade.isPermissionError(null)).toBe(false);
    expect(upgrade.isPermissionError("error")).toBe(false);
  });
});

describe("isStandaloneBinary", () => {
  it("returns true on Windows when path ends with .exe", () => {
    m.platformMock.isWindows.mockReturnValueOnce(true);
    expect(upgrade.isStandaloneBinary("C:\\bin\\flisk.exe")).toBe(true);
  });

  it("returns true on Unix when file command outputs Mach-O or ELF", () => {
    m.platformMock.isWindows.mockReturnValue(false);
    m.execFileSyncMock.mockReturnValueOnce("Mach-O 64-bit arm64 executable");
    expect(upgrade.isStandaloneBinary("/usr/local/bin/flisk")).toBe(true);

    m.execFileSyncMock.mockReturnValueOnce("ELF 64-bit LSB executable, x86-64");
    expect(upgrade.isStandaloneBinary("/usr/local/bin/flisk")).toBe(true);
  });

  it("returns false on Unix when file command outputs text or throws", () => {
    m.platformMock.isWindows.mockReturnValue(false);
    m.execFileSyncMock.mockReturnValueOnce("POSIX shell script, ASCII text executable");
    expect(upgrade.isStandaloneBinary("/usr/local/bin/flisk")).toBe(false);

    m.execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("file not found");
    });
    expect(upgrade.isStandaloneBinary("/usr/local/bin/flisk")).toBe(false);
  });
});

describe("getCurrentVersion", () => {
  it("returns the package version when getPackageVersion succeeds", () => {
    m.getPackageVersionMock.mockReturnValueOnce("1.3.186");
    expect(upgrade.getCurrentVersion()).toBe("1.3.186");
  });

  it("returns 'unknown' when getPackageVersion throws", () => {
    m.getPackageVersionMock.mockImplementationOnce(() => {
      throw new Error("package.json not found");
    });
    expect(upgrade.getCurrentVersion()).toBe("unknown");
  });
});

describe("getLatestBinaryRelease", () => {
  it("returns null when binaryAssetName() returns null", async () => {
    m.platformMock.binaryAssetName.mockReturnValueOnce(null);
    expect(await upgrade.getLatestBinaryRelease()).toBeNull();
  });

  it("returns null when GitHub API responds with non-ok status", async () => {
    m.platformMock.binaryAssetName.mockReturnValueOnce("flisk-darwin-arm64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      }),
    );
    expect(await upgrade.getLatestBinaryRelease()).toBeNull();
  });

  it("returns null when response json does not contain tag_name", async () => {
    m.platformMock.binaryAssetName.mockReturnValueOnce("flisk-darwin-arm64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      }),
    );
    expect(await upgrade.getLatestBinaryRelease()).toBeNull();
  });

  it("returns null when fetch throws an error", async () => {
    m.platformMock.binaryAssetName.mockReturnValueOnce("flisk-darwin-arm64");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network timeout")));
    expect(await upgrade.getLatestBinaryRelease()).toBeNull();
  });

  it("returns a binary release object when release is found", async () => {
    m.platformMock.binaryAssetName.mockReturnValueOnce("flisk-darwin-arm64");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: "v1.4.0" }),
      }),
    );
    const release = await upgrade.getLatestBinaryRelease();
    expect(release).toEqual({
      tag: "v1.4.0",
      assetName: "flisk-darwin-arm64",
      downloadUrl:
        "https://github.com/flisk-sh/releases/releases/download/v1.4.0/flisk-darwin-arm64",
      engineDownloadUrl:
        "https://github.com/flisk-sh/releases/releases/download/v1.4.0/flisk-cli-engine.tar.gz",
      checksumsUrl: "https://github.com/flisk-sh/releases/releases/download/v1.4.0/checksums.txt",
      checksumsBundleUrl:
        "https://github.com/flisk-sh/releases/releases/download/v1.4.0/checksums.txt.sigstore.json",
    });
  });
});

describe("getLatestVersion", () => {
  beforeEach(() => {
    m.npmViewMock.mockReset();
    m.platformMock.isWindows.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the Windows registry version including any prerelease suffix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ version: "1.4.6-rc.1" })));
    expect(await upgrade.getLatestVersion({ quiet: true })).toBe("1.4.6-rc.1");
    expect(m.npmViewMock).not.toHaveBeenCalled();
  });

  it("asks the user's own npm for the version off Windows, with a timeout", async () => {
    m.platformMock.isWindows.mockReturnValue(false);
    m.npmViewMock.mockReturnValueOnce("1.4.6\n");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await upgrade.getLatestVersion({ quiet: true })).toBe("1.4.6");
    expect(m.npmViewMock).toHaveBeenCalledWith(["view", "@flisk-sh/flisk", "version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an HTTP error", new Response(null, { status: 503 })],
    ["a missing version", Response.json({})],
    ["a non-string version", Response.json({ version: 146 })],
  ])("returns null for %s", async (_description, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
    expect(await upgrade.getLatestVersion({ quiet: true })).toBeNull();
  });
});

describe("detectInstallation and detectInstallationForPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "flisk-detect-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects a Homebrew install through the symlink on PATH", () => {
    const wrapper = join(tempDir, "Cellar", "flisk", "1.4.44", "bin", "flisk");
    mkdirSync(dirname(wrapper), { recursive: true });
    writeFileSync(wrapper, "#!/bin/bash");
    const onPath = join(tempDir, "flisk");
    symlinkSync(wrapper, onPath);

    expect(upgrade.detectInstallationForPath(onPath)).toEqual({
      method: "homebrew",
      path: realpathSync(wrapper),
    });
  });

  it("treats the running binary in the Cellar as Homebrew, so it is never replaced", () => {
    const execPath = "/opt/homebrew/Cellar/flisk/1.4.44/libexec/flisk";
    const info = upgrade.classifyRunningInstall(execPath, "", "darwin");
    expect(info).toEqual({ method: "homebrew", path: execPath });
    expect(upgrade.managedUpgradeMessage({ method: "homebrew", path: execPath })).toContain(
      "brew upgrade flisk",
    );
  });

  it("treats a Scoop shim on PATH as Scoop, so it is never replaced", () => {
    const shim = join(tempDir, "scoop", "shims", "flisk.exe");
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(shim, "MZ");

    expect(upgrade.detectInstallationForPath(shim)).toEqual({
      method: "scoop",
      path: realpathSync(shim),
    });
  });

  it("treats the running binary under scoop\\apps as Scoop", () => {
    const execPath = "C:\\Users\\dev\\scoop\\apps\\flisk\\current\\flisk.exe";
    const info = upgrade.classifyRunningInstall(execPath, "", "win32");
    expect(info).toEqual({ method: "scoop", path: execPath });
    expect(upgrade.managedUpgradeMessage({ method: "scoop", path: execPath })).toContain(
      "scoop update flisk",
    );
  });

  it("still treats a binary outside the Cellar as a standalone binary", () => {
    expect(upgrade.classifyRunningInstall("/usr/local/bin/flisk", "", "darwin")).toEqual({
      method: "binary",
      path: "/usr/local/bin/flisk",
    });
    expect(
      upgrade.managedUpgradeMessage({ method: "binary", path: "/usr/local/bin/flisk" }),
    ).toBeNull();
  });

  it("detects git install when path is in a flisk-cli checkout with .git", () => {
    const gitRoot = join(tempDir, "flisk-cli-repo");
    const binDir = join(gitRoot, "flisk-cli", "bin");
    mkdirSync(join(gitRoot, ".git"), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const fakeBin = join(binDir, "flisk");
    writeFileSync(fakeBin, "#!/bin/sh");

    const info = upgrade.detectInstallationForPath(fakeBin);
    expect(info.method).toBe("git");
    expect(info.path).toBe(realpathSync(gitRoot));
  });

  it("detects bun installation when path contains .bun", () => {
    const bunBin = join(tempDir, ".bun", "bin", "flisk");
    mkdirSync(dirname(bunBin), { recursive: true });
    writeFileSync(bunBin, "#!/bin/sh");

    const info = upgrade.detectInstallationForPath(bunBin);
    expect(info).toEqual({ method: "bun", path: bunBin });
  });

  it("detects npm installation when path contains node_modules or .npm", () => {
    const npmBin = join(tempDir, "node_modules", ".bin", "flisk");
    mkdirSync(dirname(npmBin), { recursive: true });
    writeFileSync(npmBin, "#!/bin/sh");

    const info = upgrade.detectInstallationForPath(npmBin);
    expect(info).toEqual({ method: "npm", path: npmBin });
  });

  it("detects binary install when isStandaloneBinary returns true", () => {
    const binPath = join(tempDir, "standalone-flisk");
    writeFileSync(binPath, "ELF");
    m.execFileSyncMock.mockReturnValueOnce("ELF 64-bit executable");

    const info = upgrade.detectInstallationForPath(binPath);
    expect(info.method).toBe("binary");
  });

  it("detectInstallation returns unknown when findOnPath returns null", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    try {
      m.findOnPathMock.mockReturnValueOnce(null);
      const info = upgrade.detectInstallation();
      expect(info.method).toBe("unknown");
    } finally {
      process.argv[1] = origArgv1;
    }
  });

  it("detectInstallation handles error when realpathSync throws and returns unknown", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      m.findOnPathMock.mockReturnValueOnce(join(tempDir, "nonexistent-flisk"));
      const info = upgrade.detectInstallation();
      expect(info.method).toBe("unknown");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not detect installation method"),
      );
    } finally {
      process.argv[1] = origArgv1;
      warnSpy.mockRestore();
    }
  });

  it("detectInstallation detects git repository when cliRoot contains .git", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    try {
      const standalonePath = join(tempDir, "my-flisk");
      writeFileSync(standalonePath, "some-script");
      m.findOnPathMock.mockReturnValueOnce(standalonePath);
      const info = upgrade.detectInstallation();
      expect(info.method).toBe("git");
      expect(info.path).toBeDefined();
    } finally {
      process.argv[1] = origArgv1;
    }
  });

  it("detectInstallation detects bun installation when fliskPath contains .bun", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    try {
      const bunBin = join(tempDir, ".bun", "bin", "flisk");
      mkdirSync(dirname(bunBin), { recursive: true });
      writeFileSync(bunBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValueOnce(bunBin);
      const info = upgrade.detectInstallation();
      expect(info).toEqual({ method: "bun", path: bunBin });
    } finally {
      process.argv[1] = origArgv1;
    }
  });

  it("detectInstallation detects npm installation when fliskPath contains node_modules", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    try {
      const npmBin = join(tempDir, "node_modules", ".bin", "flisk");
      mkdirSync(dirname(npmBin), { recursive: true });
      writeFileSync(npmBin, "#!/bin/sh");
      m.findOnPathMock.mockReturnValueOnce(npmBin);
      const info = upgrade.detectInstallation();
      expect(info).toEqual({ method: "npm", path: npmBin });
    } finally {
      process.argv[1] = origArgv1;
    }
  });

  // A global npm/bun install links the PATH entry to the real file inside node_modules or .bun.
  // The package manager is in the resolved path only, so detection must follow the link.
  it("detectInstallationForPath detects npm when a PATH symlink points into node_modules", () => {
    const realBin = join(tempDir, "lib", "node_modules", "@flisk-sh", "flisk", "bin", "flisk.js");
    mkdirSync(dirname(realBin), { recursive: true });
    writeFileSync(realBin, "#!/usr/bin/env node");
    const linkBin = join(tempDir, "usr-local-bin", "flisk");
    mkdirSync(dirname(linkBin), { recursive: true });
    symlinkSync(realBin, linkBin);

    const info = upgrade.detectInstallationForPath(linkBin);
    expect(info).toEqual({ method: "npm", path: linkBin });
  });

  it("detectInstallationForPath detects bun when a PATH symlink points into .bun", () => {
    const realBin = join(tempDir, ".bun", "install", "global", "node_modules", "flisk.js");
    mkdirSync(dirname(realBin), { recursive: true });
    writeFileSync(realBin, "#!/usr/bin/env node");
    const linkBin = join(tempDir, "opt-homebrew-bin", "flisk");
    mkdirSync(dirname(linkBin), { recursive: true });
    symlinkSync(realBin, linkBin);

    const info = upgrade.detectInstallationForPath(linkBin);
    expect(info).toEqual({ method: "bun", path: linkBin });
  });

  it("detectInstallation detects npm when the PATH entry is a symlink into node_modules", () => {
    const origArgv1 = process.argv[1];
    process.argv[1] = "";
    try {
      const realBin = join(tempDir, "lib", "node_modules", "@flisk-sh", "flisk", "bin", "flisk.js");
      mkdirSync(dirname(realBin), { recursive: true });
      writeFileSync(realBin, "#!/usr/bin/env node");
      const linkBin = join(tempDir, "usr-local-bin", "flisk");
      mkdirSync(dirname(linkBin), { recursive: true });
      symlinkSync(realBin, linkBin);
      m.findOnPathMock.mockReturnValueOnce(linkBin);
      const info = upgrade.detectInstallation();
      expect(info).toEqual({ method: "npm", path: linkBin });
    } finally {
      process.argv[1] = origArgv1;
    }
  });

  it("detectInstallationForPath returns unknown when path does not exist", () => {
    const nonexistent = join(tempDir, "does-not-exist");
    const info = upgrade.detectInstallationForPath(nonexistent);
    expect(info).toEqual({ method: "unknown", path: nonexistent });
  });

  it("detectInstallationForPath returns unknown when isStandaloneBinary returns false", () => {
    const scriptPath = join(tempDir, "custom-script");
    writeFileSync(scriptPath, "#!/bin/sh");
    m.execFileSyncMock.mockReturnValueOnce("POSIX shell script text executable");

    const info = upgrade.detectInstallationForPath(scriptPath);
    expect(info).toEqual({ method: "unknown", path: scriptPath });
  });
});

describe("detectAllInstallations", () => {
  it("deduplicates multiple binary entries and ignores unknown", () => {
    m.findOnPathMock.mockReturnValue(null);
    m.findAllOnPathMock.mockReturnValueOnce([
      "/usr/local/bin/flisk",
      "/usr/bin/flisk",
      "/nonexistent/flisk",
    ]);
    m.execFileSyncMock.mockReturnValue("Mach-O 64-bit arm64 executable");

    const all = upgrade.detectAllInstallations();
    expect(Array.isArray(all)).toBe(true);
  });
});
