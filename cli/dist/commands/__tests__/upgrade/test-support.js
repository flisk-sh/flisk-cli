// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { captureExit } from "../../../test-support/doubles.js";
import { ProcessExitError } from "../../../utils/errors.js";
const execSyncMock = vi.fn();
const execFileSyncMock = vi.fn();
const npmViewMock = vi.fn();
const sigstoreVerifyMock = vi.fn();
const promptConfirmMock = vi.fn(async (_opts) => true);
const findOnPathMock = vi.fn((_cmd) => null);
const findAllOnPathMock = vi.fn((_cmd) => []);
const getPackageVersionMock = vi.fn(() => "1.3.186");
const platformMock = {
    isWindows: vi.fn(() => process.platform === "win32"),
    binaryAssetName: vi.fn(() => process.platform === "win32" ? "flisk-windows-amd64.exe" : "flisk-darwin-arm64"),
    executableName: vi.fn(() => (process.platform === "win32" ? "flisk.exe" : "flisk")),
};
const childProcessMock = {
    execSync: (...args) => execSyncMock(...args),
    execFileSync: (...args) => args[0] === "npm" && args[1]?.[0] === "view"
        ? npmViewMock(args[1], args[2])
        : execFileSyncMock(...args),
};
const sigstoreMock = { verify: sigstoreVerifyMock };
const tarMock = {
    extractTarball: (_data, destination) => {
        mkdirSync(destination, { recursive: true });
        writeFileSync(join(destination, "engine-marker"), "extracted");
    },
};
const promptMock = {
    promptConfirm: (opts) => promptConfirmMock(opts),
};
const whichMock = {
    findOnPath: (cmd) => findOnPathMock(cmd),
    findAllOnPath: (cmd) => findAllOnPathMock(cmd),
};
export async function pathsMockFactory(importOriginal) {
    const actual = await importOriginal();
    return {
        ...actual,
        getPackageVersion: () => getPackageVersionMock(),
    };
}
export async function platformModuleMockFactory(importOriginal) {
    const actual = await importOriginal();
    return {
        ...actual,
        isWindows: () => platformMock.isWindows(),
        binaryAssetName: () => platformMock.binaryAssetName(),
        executableName: () => platformMock.executableName(),
    };
}
export const m = {
    childProcessMock,
    execFileSyncMock,
    execSyncMock,
    findAllOnPathMock,
    findOnPathMock,
    getPackageVersionMock,
    npmViewMock,
    pathsMockFactory,
    platformMock,
    platformModuleMockFactory,
    promptConfirmMock,
    promptMock,
    sigstoreMock,
    sigstoreVerifyMock,
    tarMock,
    whichMock,
};
export async function loadUpgrade() {
    return await import("../../upgrade.js");
}
export function registerUpgradeMocks() {
    vi.doMock("node:child_process", () => childProcessMock);
    vi.doMock("sigstore", () => sigstoreMock);
    vi.doMock("../../../utils/tar.js", () => tarMock);
    vi.doMock("../../../utils/prompt.js", () => promptMock);
    vi.doMock("../../../utils/which.js", () => whichMock);
    vi.doMock("../../../utils/paths.js", (importOriginal) => pathsMockFactory(importOriginal));
    vi.doMock("../../../utils/platform.js", (importOriginal) => platformModuleMockFactory(importOriginal));
}
export function setupUpgradeCommandTests(upgrade) {
    let tmp = "";
    const origArgv1 = process.argv[1];
    const origExecPath = process.execPath;
    const origPlatform = process.platform;
    beforeEach(() => {
        process.argv[1] = "";
        Object.defineProperty(process, "execPath", {
            value: "/usr/local/bin/node",
            configurable: true,
        });
        Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
        tmp = mkdtempSync(join(tmpdir(), "flisk-cmd-test-"));
        execSyncMock.mockReset();
        execFileSyncMock.mockReset();
        npmViewMock.mockReset();
        npmViewMock.mockReturnValue("1.4.0\n");
        findOnPathMock.mockReset();
        findAllOnPathMock.mockReset();
        promptConfirmMock.mockReset();
        promptConfirmMock.mockResolvedValue(true);
        getPackageVersionMock.mockReturnValue("1.3.186");
        platformMock.isWindows.mockReturnValue(false);
        platformMock.binaryAssetName.mockReturnValue("flisk-darwin-arm64");
        platformMock.executableName.mockReturnValue("flisk");
        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ version: "1.4.0" })));
    });
    afterEach(() => {
        process.argv[1] = origArgv1;
        Object.defineProperty(process, "execPath", { value: origExecPath, configurable: true });
        Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
        rmSync(tmp, { recursive: true, force: true });
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });
    async function runUpgrade(args = []) {
        const exit = captureExit();
        let stdout = "";
        let stderr = "";
        const logSpy = vi.spyOn(console, "log").mockImplementation((...lines) => {
            stdout += `${lines.map(String).join(" ")}\n`;
        });
        const errorSpy = vi.spyOn(console, "error").mockImplementation((...lines) => {
            stderr += `${lines.map(String).join(" ")}\n`;
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation((...lines) => {
            stderr += `${lines.map(String).join(" ")}\n`;
        });
        const cmd = upgrade.createUpgradeCommand();
        let status;
        try {
            await cmd.parseAsync(args, { from: "user" });
        }
        catch (err) {
            if (!(err instanceof ProcessExitError)) {
                throw err;
            }
        }
        finally {
            status = exit.exit.mock.calls[0]?.[0];
            exit.exit.mockRestore();
            logSpy.mockRestore();
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
        return { status, stdout, stderr };
    }
    return {
        getTmp: () => tmp,
        runUpgrade,
    };
}
export async function loadUpgradeWithMocks() {
    registerUpgradeMocks();
    return await loadUpgrade();
}
export function gitRebuildExecHandler({ branch = "main\n", mode, }) {
    return (_cmd, args) => {
        if (args[0] === "rev-parse" && args[1] === "--git-dir")
            return ".git";
        if (args[0] === "fetch")
            return "";
        if (args[0] === "status" && args[1] === "--porcelain")
            return "";
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref")
            return branch;
        if (args[0] === "symbolic-ref")
            return "origin/main\n";
        if (args[0] === mode)
            return "";
        if (args[0] === "install" || args[0] === "run" || args[0] === "link")
            return "";
        return "";
    };
}
export function gitUpgradeExecHandler({ version = "1.4.0\n", versionError, } = {}) {
    return (_cmd, args) => {
        if (args?.[0] === "fetch")
            return "";
        if (args?.[0] === "rev-parse" && args[1] === "HEAD")
            return "aaaaaaa111111\n";
        if (args?.[0] === "rev-parse" && args[1] === "origin/main")
            return "bbbbbbb222222\n";
        if (args?.[0] === "rev-parse" && args[1] === "--git-dir")
            return ".git";
        if (args?.[0] === "status" && args[1] === "--porcelain")
            return "";
        if (args?.[0] === "rev-parse" && args[1] === "--abbrev-ref")
            return "main\n";
        if (args?.[0] === "symbolic-ref")
            return "origin/main\n";
        if (args?.[0] === "pull")
            return "";
        if (args?.[0] === "install" || args?.[0] === "run" || args?.[0] === "link")
            return "";
        if (args?.[0] === "version") {
            if (versionError)
                throw versionError;
            return version;
        }
        return "";
    };
}
export function stubFetchLatestRelease(tag) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: tag }) }));
}
export function stubFetchReleaseNotFound() {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
}
export function stubFetchLatestThenAssetFailure() {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => {
        if (url.includes("/releases/latest")) {
            return { ok: true, json: async () => ({ tag_name: "v1.4.0" }) };
        }
        return { ok: false, status: 500 };
    }));
}
function toFetchUrl(input) {
    return typeof input === "string"
        ? new URL(input)
        : input instanceof URL
            ? input
            : new URL(input.url);
}
function isGitHubApiReleaseUrl(url) {
    return (url.protocol === "https:" &&
        url.hostname === "api.github.com" &&
        url.pathname.startsWith("/repos/"));
}
function isChecksumsUrl(url) {
    return (url.protocol === "https:" &&
        url.hostname === "github.com" &&
        url.pathname.endsWith("/checksums.txt"));
}
function isSigstoreUrl(url) {
    return url.pathname.endsWith("/checksums.txt.sigstore.json");
}
function isReleaseAssetUrl(url) {
    return (url.protocol === "https:" &&
        url.hostname === "github.com" &&
        url.pathname.includes("/releases/download/"));
}
export function createGitHubReleaseFetch({ sumsText, tag = "v1.4.0", includeChecksumsArrayBuffer = false, includeSigstoreMetadata = false, }) {
    return vi.fn().mockImplementation(async (input) => {
        const url = toFetchUrl(input);
        if (isGitHubApiReleaseUrl(url)) {
            return { ok: true, status: 200, json: async () => ({ tag_name: tag }) };
        }
        if (isChecksumsUrl(url)) {
            return {
                ok: true,
                status: 200,
                ...(includeChecksumsArrayBuffer ? { arrayBuffer: async () => Buffer.from(sumsText) } : {}),
                text: async () => sumsText,
            };
        }
        if (includeSigstoreMetadata && isSigstoreUrl(url)) {
            return { ok: true, status: 200, text: async () => "{}" };
        }
        if (isReleaseAssetUrl(url)) {
            return {
                ok: true,
                status: 200,
                arrayBuffer: async () => Buffer.from(url.pathname.includes("engine") ? "fake-engine" : "fake-bin"),
            };
        }
        throw new Error(`Unexpected fetch URL: ${url.href}`);
    });
}
export function expectUpgradeJsonEnvelope(envelope, expected) {
    expect(envelope).toEqual({
        schemaVersion: 1,
        data: { dryRun: true, ...expected },
        errors: [],
    });
}
