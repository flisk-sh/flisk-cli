// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findOnPath } from "../utils/which.js";
import { createTempDir } from "./temp-project.js";
export const git = (cwd, ...args) => execFileSync(findOnPath("git") ?? "git", args, { cwd, encoding: "utf-8" }).trim();
/** A local repository with a single commit; returns its path. */
export function singleCommitRepo(files = {}) {
    const repo = createTempDir("flisk-test-repo-");
    git(repo, "init", "--quiet");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    for (const [path, content] of Object.entries(files)) {
        const dir = dirname(join(repo, path));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(repo, path), content);
    }
    if (Object.keys(files).length > 0) {
        // -f: a developer's global gitignore can exclude files a fixture deliberately
        // commits, such as a shipped .env (#3883).
        git(repo, "add", "-f", ".");
        git(repo, "commit", "--quiet", "-m", "initial");
    }
    return repo;
}
