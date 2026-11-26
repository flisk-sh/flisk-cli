// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadUpgrade, m } from "./test-support.js";

vi.doMock("node:child_process", () => m.childProcessMock);
vi.doMock("sigstore", () => m.sigstoreMock);
vi.doMock("../../../utils/tar.js", () => m.tarMock);

const upgrade = await loadUpgrade();

import type { BinaryRelease } from "../../upgrade.js";

const BINARY_BYTES = "fake flisk binary";

const ENGINE_BYTES = "fake engine tarball";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const SIGNER =
  "https://github.com/flisk-sh/flisk-cli/.github/workflows/release-binaries.yml@refs/heads/main";

describe("upgradeViaBinary", () => {
  let bundleStatus = 200;
  const serve = (url: string) => {
    if (url === release.checksumsBundleUrl)
      return {
        ok: bundleStatus === 200,
        status: bundleStatus,
        text: async () => JSON.stringify({ mediaType: "bundle" }),
      };
    const body =
      url === release.checksumsUrl
        ? checksums
        : url === release.engineDownloadUrl
          ? ENGINE_BYTES
          : BINARY_BYTES;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from(body),
      text: async () => body,
    };
  };
  let installDir: string;
  let fliskPath: string;
  let release: BinaryRelease;
  let checksums: string;
  const fetchMock = vi.fn();

  beforeEach(() => {
    bundleStatus = 200;
    vi.stubEnv("FLISK_UPGRADE_REQUIRE_SIGNATURE", "");
    installDir = mkdtempSync(join(tmpdir(), "flisk-upgrade-test-"));
    fliskPath = join(installDir, "flisk");
    release = {
      tag: "v1.3.21",
      assetName: "flisk-darwin-arm64",
      downloadUrl: "https://example.test/flisk-darwin-arm64",
      engineDownloadUrl: "https://example.test/flisk-cli-engine.tar.gz",
      checksumsUrl: "https://example.test/checksums.txt",
      checksumsBundleUrl: "https://example.test/checksums.txt.sigstore.json",
    };
    checksums = [
      `${sha256(BINARY_BYTES)}  flisk-darwin-arm64`,
      `${sha256("other platform")}  flisk-linux-amd64`,
      `${sha256(ENGINE_BYTES)}  flisk-cli-engine.tar.gz`,
    ].join("\n");
    m.execSyncMock.mockReset();
    fetchMock.mockReset();
    m.sigstoreVerifyMock.mockReset();
    // Default: a valid bundle signed by the release workflow, over exactly the bytes served.
    m.sigstoreVerifyMock.mockImplementation(async (_bundle: unknown, data: Buffer) => {
      if (data.toString("utf8") !== checksums) throw new Error("signature does not match data");
      return { identity: { subjectAlternativeName: SIGNER } };
    });
    fetchMock.mockImplementation(async (url: string) => serve(url));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("downloads and extracts the bundled engine tarball next to the binary, not just the binary itself", async () => {
    const ok = await upgrade.upgradeViaBinary(fliskPath, release);
    expect(ok).toBe(true);

    const engineDir = join(installDir, "flisk-cli");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      release.downloadUrl,
      release.engineDownloadUrl,
      release.checksumsUrl,
      release.checksumsBundleUrl,
    ]);
    expect(readFileSync(fliskPath, "utf-8")).toBe(BINARY_BYTES);
    expect(readFileSync(join(engineDir, "engine-marker"), "utf-8")).toBe("extracted");
  });

  it.skipIf(process.platform === "win32")(
    "installs the binary with the executable bit set",
    async () => {
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);
      expect(ok).toBe(true);
      expect(statSync(fliskPath).mode & 0o111).toBe(0o111);
    },
  );

  it("downloads both the binary and the engine tarball before installing either", async () => {
    await upgrade.upgradeViaBinary(fliskPath, release);

    expect(fetchMock).toHaveBeenNthCalledWith(1, release.downloadUrl, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, release.engineDownloadUrl, expect.any(Object));
    expect(readFileSync(fliskPath, "utf-8")).toBe(BINARY_BYTES);
  });

  it("verifies checksums after both downloads and before installing anything", async () => {
    await upgrade.upgradeViaBinary(fliskPath, release);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      release.downloadUrl,
      release.engineDownloadUrl,
      release.checksumsUrl,
      release.checksumsBundleUrl,
    ]);
    expect(existsSync(fliskPath)).toBe(true);
  });

  it.each([
    [
      "the binary does not match",
      () => checksums.replace(sha256(BINARY_BYTES), sha256("tampered")),
    ],
    [
      "the engine tarball does not match",
      () => checksums.replace(sha256(ENGINE_BYTES), sha256("x")),
    ],
    [
      "checksums.txt has no entry for the binary",
      () => checksums.replace("flisk-darwin-arm64", "x"),
    ],
  ])("refuses to install when %s", async (_case, makeChecksums) => {
    checksums = makeChecksums();
    const ok = await upgrade.upgradeViaBinary(fliskPath, release);

    expect(ok).toBe(false);
    expect(existsSync(fliskPath)).toBe(false);
  });

  describe("checksums.txt signature", () => {
    it("installs when the bundle verifies against checksums.txt", async () => {
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);

      expect(ok).toBe(true);
      expect(readFileSync(fliskPath, "utf-8")).toBe(BINARY_BYTES);
      expect(fetchMock).toHaveBeenCalledWith(release.checksumsBundleUrl, expect.any(Object));
      expect(m.sigstoreVerifyMock).toHaveBeenCalledWith(
        { mediaType: "bundle" },
        Buffer.from(checksums),
        expect.objectContaining({
          certificateIssuer: "https://token.actions.githubusercontent.com",
        }),
      );
    });

    it("refuses tampered checksums.txt even when its entries match the downloads", async () => {
      // Attacker swaps binary and checksums together; the signed bytes differ.
      m.sigstoreVerifyMock.mockRejectedValue(new Error("signature does not match data"));
      writeFileSync(fliskPath, "old binary");
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);

      expect(ok).toBe(false);
      expect(readFileSync(fliskPath, "utf-8")).toBe("old binary");
    });

    it("refuses a bundle signed by another identity", async () => {
      m.sigstoreVerifyMock.mockResolvedValue({
        identity: {
          subjectAlternativeName:
            "https://github.com/evil/flisk/.github/workflows/release-binaries.yml@refs/heads/main",
        },
      });
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);

      expect(ok).toBe(false);
      expect(existsSync(fliskPath)).toBe(false);
    });

    it("refuses a release at or after v1.3.130 that has no bundle, without any env var", async () => {
      bundleStatus = 404;
      for (const tag of ["v1.3.130", "v1.4.64", "v2.0.0"]) {
        const ok = await upgrade.upgradeViaBinary(fliskPath, { ...release, tag });
        expect(ok).toBe(false);
        expect(existsSync(fliskPath)).toBe(false);
      }
      expect(m.sigstoreVerifyMock).not.toHaveBeenCalled();
    });

    it("fails clearly, and installs nothing, when the trust root cannot be fetched", async () => {
      m.sigstoreVerifyMock.mockRejectedValue(
        Object.assign(new Error("failed to fetch root.json"), {
          code: "TUF_REFRESH_METADATA_ERROR",
        }),
      );
      const errors: unknown[] = [];
      const { verifyChecksumsSignature } = await import("../../upgrade.js");
      await verifyChecksumsSignature(
        Buffer.from(checksums),
        release.checksumsBundleUrl,
        release.tag,
      ).catch((e: unknown) => errors.push(e));
      const message = String((errors[0] as Error)?.message);
      expect(message).toContain("trust root");
      expect(message).toContain("failed to fetch root.json");
      expect(JSON.stringify((errors[0] as { suggestions?: string[] }).suggestions)).toContain(
        "FLISK_UPGRADE_REQUIRE_SIGNATURE",
      );

      const ok = await upgrade.upgradeViaBinary(fliskPath, release);
      expect(ok).toBe(false);
      expect(existsSync(fliskPath)).toBe(false);
    });

    it("warns and continues on checksums when an older release has no bundle", async () => {
      release = { ...release, tag: "v1.3.129" };
      bundleStatus = 404;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);

      expect(ok).toBe(true);
      expect(m.sigstoreVerifyMock).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(" ")).toContain("no signature");
      warn.mockRestore();
    });

    it("refuses an older release with no bundle when FLISK_UPGRADE_REQUIRE_SIGNATURE=1", async () => {
      release = { ...release, tag: "v1.3.129" };
      bundleStatus = 404;
      vi.stubEnv("FLISK_UPGRADE_REQUIRE_SIGNATURE", "1");
      const ok = await upgrade.upgradeViaBinary(fliskPath, release);

      expect(ok).toBe(false);
      expect(existsSync(fliskPath)).toBe(false);
    });
  });

  it("still installs releases whose checksums.txt predates the engine entry", async () => {
    checksums = checksums
      .split("\n")
      .filter((line) => !line.endsWith("flisk-cli-engine.tar.gz"))
      .join("\n");
    const ok = await upgrade.upgradeViaBinary(fliskPath, release);

    expect(ok).toBe(true);
    expect(existsSync(fliskPath)).toBe(true);
  });

  it.each([
    ["the engine tarball", () => release.engineDownloadUrl],
    ["checksums.txt", () => release.checksumsUrl],
  ])("leaves the existing install alone when %s download fails", async (_case, failingUrl) => {
    writeFileSync(fliskPath, "old binary");
    const url = failingUrl();
    fetchMock.mockImplementation(async (requested: string) =>
      requested === url ? { ok: false, status: 503 } : serve(requested),
    );

    const ok = await upgrade.upgradeViaBinary(fliskPath, release);

    expect(ok).toBe(false);
    expect(readFileSync(fliskPath, "utf-8")).toBe("old binary");
    expect(existsSync(join(installDir, "flisk-cli"))).toBe(false);
  });

  it("replaces an existing binary and engine folder and removes both backups", async () => {
    writeFileSync(fliskPath, "old binary");
    const engineDir = join(installDir, "flisk-cli");
    mkdirSync(engineDir);
    writeFileSync(join(engineDir, "old-engine-file"), "old");

    const ok = await upgrade.upgradeViaBinary(fliskPath, release);

    expect(ok).toBe(true);
    expect(readFileSync(fliskPath, "utf-8")).toBe(BINARY_BYTES);
    expect(readFileSync(join(engineDir, "engine-marker"), "utf-8")).toBe("extracted");
    expect(existsSync(join(engineDir, "old-engine-file"))).toBe(false);
    const leftovers = readdirSync(installDir).filter(
      (name) => name !== "flisk" && name !== "flisk-cli",
    );
    expect(leftovers).toEqual([]);
  });

  // root ignores the write-permission bit (accessSync(W_OK) legitimately
  // returns true even on a 0o555 dir), so these checks only hold for
  // non-root users.
  const isRoot = process.getuid?.() === 0;

  it.skipIf(isRoot)(
    "never shells out to sudo, and fails fast without touching the network when the install dir isn't writable",
    async () => {
      chmodSync(installDir, 0o555);
      try {
        const ok = await upgrade.upgradeViaBinary(fliskPath, release);
        expect(ok).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        chmodSync(installDir, 0o755);
      }
    },
  );

  it.skipIf(isRoot)("isWritable reflects actual filesystem permissions", () => {
    expect(upgrade.isWritable(installDir)).toBe(true);
    chmodSync(installDir, 0o555);
    try {
      expect(upgrade.isWritable(installDir)).toBe(false);
    } finally {
      chmodSync(installDir, 0o755);
    }
  });

  describe("Windows locked executable cleanup (#4007)", () => {
    it("moves the running exe to flisk.exe.old, ignores EPERM on backup delete, removes engine backup and tempDir, and reports success", async () => {
      const winFliskPath = join(installDir, "flisk.exe");
      const winRelease: BinaryRelease = {
        ...release,
        assetName: "flisk-windows-amd64.exe",
        downloadUrl: "https://example.test/flisk-windows-amd64.exe",
      };
      checksums = [
        `${sha256(BINARY_BYTES)}  flisk-windows-amd64.exe`,
        `${sha256(ENGINE_BYTES)}  flisk-cli-engine.tar.gz`,
      ].join("\n");
      writeFileSync(winFliskPath, "running old exe");
      const engineDir = join(installDir, "flisk-cli");
      mkdirSync(engineDir);
      writeFileSync(join(engineDir, "old-engine-file"), "old");

      const rmCalls: string[] = [];
      const injectedRmSync = ((
        targetPath: Parameters<typeof rmSync>[0],
        opts?: Parameters<typeof rmSync>[1],
      ) => {
        const strPath = String(targetPath);
        rmCalls.push(strPath);
        if (strPath === `${winFliskPath}.old`) {
          throw Object.assign(new Error("EPERM: operation not permitted, unlink"), {
            code: "EPERM",
          });
        }
        rmSync(targetPath, opts);
      }) as typeof rmSync;

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const ok = await upgrade.upgradeViaBinary(winFliskPath, winRelease, {
          isWindows: () => true,
          rmSync: injectedRmSync,
        });

        expect(ok).toBe(true);
        expect(readFileSync(winFliskPath, "utf-8")).toBe(BINARY_BYTES);
        expect(readFileSync(join(engineDir, "engine-marker"), "utf-8")).toBe("extracted");
        expect(existsSync(join(engineDir, "old-engine-file"))).toBe(false);
        expect(existsSync(`${winFliskPath}.old`)).toBe(true);
        // Engine backup and the .flisk-upgrade-* temp dir were both removed cleanly.
        expect(rmCalls.some((p) => p.endsWith("flisk-cli.previous"))).toBe(true);
        const leftovers = readdirSync(installDir).filter((name) =>
          name.startsWith(".flisk-upgrade-"),
        );
        expect(leftovers).toEqual([]);
        expect(logSpy.mock.calls.flat().join("\n")).not.toContain("Binary upgrade failed");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("still succeeds when fallback backup and tempDir removal throw EBUSY/EPERM on Windows", async () => {
      const winFliskPath = join(installDir, "flisk.exe");
      const winRelease: BinaryRelease = {
        ...release,
        assetName: "flisk-windows-amd64.exe",
        downloadUrl: "https://example.test/flisk-windows-amd64.exe",
      };
      checksums = [
        `${sha256(BINARY_BYTES)}  flisk-windows-amd64.exe`,
        `${sha256(ENGINE_BYTES)}  flisk-cli-engine.tar.gz`,
      ].join("\n");
      writeFileSync(winFliskPath, "running old exe");
      // Simulate an already-locked flisk.exe.old from a previous run so backup falls back into tempDir.
      writeFileSync(`${winFliskPath}.old`, "still locked from prior run");

      const injectedRmSync = ((
        targetPath: Parameters<typeof rmSync>[0],
        opts?: Parameters<typeof rmSync>[1],
      ) => {
        const strPath = String(targetPath);
        if (
          strPath.endsWith(".old") ||
          strPath.endsWith(".previous") ||
          /\.flisk-upgrade-\d+-\d+$/.test(strPath)
        ) {
          throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        }
        rmSync(targetPath, opts);
      }) as typeof rmSync;

      const ok = await upgrade.upgradeViaBinary(winFliskPath, winRelease, {
        isWindows: () => true,
        rmSync: injectedRmSync,
      });

      expect(ok).toBe(true);
      expect(readFileSync(winFliskPath, "utf-8")).toBe(BINARY_BYTES);
    });

    it("cleans up stale flisk.exe.old and dead .flisk-upgrade-* folders at the start of the next upgrade", async () => {
      const winFliskPath = join(installDir, "flisk.exe");
      const winRelease: BinaryRelease = {
        ...release,
        assetName: "flisk-windows-amd64.exe",
        downloadUrl: "https://example.test/flisk-windows-amd64.exe",
      };
      checksums = [
        `${sha256(BINARY_BYTES)}  flisk-windows-amd64.exe`,
        `${sha256(ENGINE_BYTES)}  flisk-cli-engine.tar.gz`,
      ].join("\n");
      writeFileSync(winFliskPath, "previous exe");
      writeFileSync(`${winFliskPath}.old`, "stale old exe");
      const staleDir = join(installDir, ".flisk-upgrade-999999999-1700000000000");
      mkdirSync(staleDir);
      writeFileSync(join(staleDir, "flisk.exe.previous"), "stale");

      const ok = await upgrade.upgradeViaBinary(winFliskPath, winRelease, {
        isWindows: () => true,
      });

      expect(ok).toBe(true);
      expect(existsSync(staleDir)).toBe(false);
      expect(existsSync(`${winFliskPath}.old`)).toBe(false);
    });

    it("keeps EPERM on backup delete fatal on non-Windows platforms", async () => {
      writeFileSync(fliskPath, "old binary");
      const injectedRmSync = ((
        targetPath: Parameters<typeof rmSync>[0],
        opts?: Parameters<typeof rmSync>[1],
      ) => {
        if (String(targetPath).endsWith(".previous")) {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        }
        rmSync(targetPath, opts);
      }) as typeof rmSync;

      const ok = await upgrade.upgradeViaBinary(fliskPath, release, {
        isWindows: () => false,
        rmSync: injectedRmSync,
      });

      expect(ok).toBe(false);
    });
  });
});
