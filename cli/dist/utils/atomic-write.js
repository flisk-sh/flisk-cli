// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { randomBytes } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { basename, dirname, join } from "node:path";
import { FliskError } from "./errors.js";
/**
 * Replaces `filePath` in one step. A plain writeFileSync truncates first, so an interrupt mid-write leaves a
 * half-written file that looks current; here readers see the old content or the new content, never a mix.
 * An identical file is left alone, so a repeat generation does not change its mtime (#3830).
 */
export function writeTextFileAtomic(filePath, content) {
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    let mode;
    try {
        const existing = statSync(filePath);
        mode = existing.mode & 0o777;
        if (existing.isFile() && readFileSync(filePath).equals(Buffer.from(content, "utf-8"))) {
            return;
        }
    }
    catch {
        mode = undefined;
    }
    try {
        const fd = openSync(tempPath, "wx");
        try {
            if (mode !== undefined)
                fchmodSync(fd, mode);
            writeFileSync(fd, content, "utf-8");
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(tempPath, filePath);
    }
    catch (error) {
        rmSync(tempPath, { force: true });
        throw error;
    }
}
function makeSiblingTempDir(targetDir, suffix) {
    return join(dirname(targetDir), `.${basename(targetDir)}.${process.pid}.${randomBytes(4).toString("hex")}.${suffix}`);
}
function directoryTreesMatch(stagedDir, targetDir) {
    let targetStat;
    try {
        targetStat = statSync(targetDir);
    }
    catch {
        return false;
    }
    if (!targetStat.isDirectory())
        return false;
    const byName = (a, b) => a.name.localeCompare(b.name);
    const stagedEntries = readdirSync(stagedDir, { withFileTypes: true }).sort(byName);
    const targetEntries = readdirSync(targetDir, { withFileTypes: true }).sort(byName);
    if (stagedEntries.length !== targetEntries.length)
        return false;
    for (let i = 0; i < stagedEntries.length; i++) {
        const staged = stagedEntries[i];
        const target = targetEntries[i];
        if (staged.name !== target.name ||
            staged.isSymbolicLink() ||
            target.isSymbolicLink() ||
            staged.isDirectory() !== target.isDirectory()) {
            return false;
        }
        const stagedPath = join(stagedDir, staged.name);
        const targetPath = join(targetDir, target.name);
        if (staged.isDirectory()) {
            if (!directoryTreesMatch(stagedPath, targetPath))
                return false;
        }
        else {
            try {
                if (statSync(stagedPath).size !== statSync(targetPath).size ||
                    !readFileSync(stagedPath).equals(readFileSync(targetPath))) {
                    return false;
                }
            }
            catch {
                return false;
            }
        }
    }
    return true;
}
/** Drop a staged tree when it holds exactly the bytes already present, leaving the target's mtimes alone (#3830). */
function discardStagedIfUnchanged(stageDir, targetDir) {
    if (!directoryTreesMatch(stageDir, targetDir))
        return false;
    rmSync(stageDir, { recursive: true, force: true });
    return true;
}
function swapStagedDirectory(stageDir, targetDir) {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Fast path: target does not exist yet.
        try {
            renameSync(stageDir, targetDir);
            return;
        }
        catch (error) {
            const code = error.code;
            if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM" && code !== "EACCES") {
                throw error;
            }
        }
        // Target already exists: move it aside to a unique sibling path, swap stage in, then remove backup.
        const backupDir = makeSiblingTempDir(targetDir, "old");
        let movedTarget = false;
        try {
            renameSync(targetDir, backupDir);
            movedTarget = true;
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                // Another caller just displaced targetDir; retry direct rename.
                continue;
            }
            if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") &&
                attempt < maxAttempts - 1) {
                continue;
            }
            throw error;
        }
        try {
            renameSync(stageDir, targetDir);
        }
        catch (error) {
            const code = error.code;
            if (movedTarget) {
                try {
                    renameSync(backupDir, targetDir);
                }
                catch {
                    // Another caller already placed a fresh directory at targetDir; discard our stale backup.
                    rmSync(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
                }
            }
            if ((code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM" || code === "EACCES") &&
                attempt < maxAttempts - 1) {
                continue;
            }
            throw error;
        }
        try {
            rmSync(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        }
        catch {
            // Best-effort cleanup of the displaced backup directory.
        }
        return;
    }
    throw new FliskError(`Failed to atomically replace directory ${targetDir} after concurrent updates`, [
        "Another flisk command may still be writing to this folder; run the command again",
        `If it keeps failing, remove ${targetDir} and let flisk regenerate it`,
    ]);
}
/**
 * Populates a unique sibling staging directory via `populate(stageDir)` and swaps it into
 * `targetDir`, avoiding in-place cpSync/unlink/chmod races across concurrent callers.
 * An identical tree is discarded instead, so repeat generation leaves mtimes alone (#3830).
 */
export function replaceDirectoryAtomicSync(targetDir, populate) {
    mkdirSync(dirname(targetDir), { recursive: true });
    const stageDir = makeSiblingTempDir(targetDir, "tmp");
    mkdirSync(stageDir, { recursive: true });
    try {
        populate(stageDir);
        if (discardStagedIfUnchanged(stageDir, targetDir))
            return;
        swapStagedDirectory(stageDir, targetDir);
    }
    catch (error) {
        rmSync(stageDir, { recursive: true, force: true });
        throw error;
    }
}
/**
 * Async variant of `replaceDirectoryAtomicSync` for staging steps that perform async work
 * before swapping the completed tree into `targetDir`.
 */
export async function replaceDirectoryAtomic(targetDir, populate) {
    mkdirSync(dirname(targetDir), { recursive: true });
    const stageDir = makeSiblingTempDir(targetDir, "tmp");
    mkdirSync(stageDir, { recursive: true });
    try {
        await populate(stageDir);
        if (discardStagedIfUnchanged(stageDir, targetDir))
            return;
        swapStagedDirectory(stageDir, targetDir);
    }
    catch (error) {
        rmSync(stageDir, { recursive: true, force: true });
        throw error;
    }
}
