#!/usr/bin/env node
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// npm runs `prepare` on a local install, including installs from a GitHub URL. `prepare` must never block installation:
// a temporary checkout has no .git directory, and a source tree may ship no hooks. Hooks are only configured when both
// a Git checkout and the repository's .githooks directory are present.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run git with a fixed, system-owned PATH so a writable directory on the caller's PATH cannot shadow it.
const GIT_ENV = {
  ...process.env,
  PATH:
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32"
      : "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
};

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Resolve git from the absolute directories on PATH only, so a relative or empty entry (a writable working
// directory) can never supply the executable.
function findGit() {
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    for (const name of names) {
      try {
        if (statSync(join(dir, name)).isFile()) return join(dir, name);
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

const GIT = findGit();

function hasGitDirectory() {
  if (!GIT) return false;
  const result = spawnSync(GIT, ["-C", ROOT_DIR, "rev-parse", "--git-dir"], {
    stdio: "ignore",
    env: GIT_ENV,
    windowsHide: true,
  });
  return result.status === 0;
}

function hasHooksDirectory() {
  try {
    return statSync(join(ROOT_DIR, ".githooks")).isDirectory();
  } catch {
    return false;
  }
}

try {
  if (hasGitDirectory() && hasHooksDirectory()) {
    spawnSync(GIT, ["-C", ROOT_DIR, "config", "core.hooksPath", ".githooks"], {
      stdio: "ignore",
      env: GIT_ENV,
      windowsHide: true,
    });
  }
} catch {
  // Installing hooks is best-effort; never make `npm install` fail because of them.
} finally {
  process.exit(0);
}
