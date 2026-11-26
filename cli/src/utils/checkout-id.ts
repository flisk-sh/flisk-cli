// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ensureCheckoutRecordIgnored } from "./file-helpers.js";

/** Environment variable exposing the stable per-checkout 8-hex identifier. */
export const CHECKOUT_ID_ENV = "FLISK_CHECKOUT_ID";

/** Environment variable exposing the sanitized per-checkout folder name. */
export const CHECKOUT_NAME_ENV = "FLISK_CHECKOUT_NAME";

/** Relative path under a project root where the path-bound checkout id is stored. */
export const CHECKOUT_ID_RELATIVE_PATH = join(".flisk", ".project-id");

const CHECKOUT_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Stable identity of a local checkout (git worktree, clone, or copy). */
export interface CheckoutIdentity {
  id: string;
  name: string;
}

interface PersistedCheckoutId {
  id: string;
  path: string;
  /** Short checkout-id prefix appended to a checkout host when its name collides with a running stack (#4697). */
  hostSuffix?: string;
}

/**
 * True when `projectRoot` is a linked git worktree: its `.git` is a file whose
 * first line points at the worktree's gitdir. A normal clone has a `.git`
 * directory instead, and keeps the original host names (#4697).
 */
export function isLinkedGitWorktree(projectRoot: string): boolean {
  let dir: string;
  try {
    dir = resolve(projectRoot);
  } catch {
    return false;
  }
  for (;;) {
    const gitPath = join(dir, ".git");
    try {
      const entry = statSync(gitPath);
      // The first `.git` entry is the repository boundary: a clone nested in a linked worktree is a normal
      // clone, so a `.git` directory ends the walk instead of letting the outer worktree's file win.
      if (entry.isDirectory()) return false;
      return entry.isFile() && readFileSync(gitPath, "utf-8").startsWith("gitdir:");
    } catch {
      // No .git here (or an unreadable one): keep walking, as git does.
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Sanitizes a directory name into lowercase `[a-z0-9-]` characters for use as `FLISK_CHECKOUT_NAME`.
 */
export function sanitizeCheckoutName(rawName: string): string {
  const sanitized = rawName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-");
  return sanitized || "checkout";
}

/**
 * Returns the sanitized checkout name derived from the project root folder name.
 */
export function getCheckoutName(projectRoot: string): string {
  return sanitizeCheckoutName(basename(resolve(projectRoot)));
}

/**
 * Resolves a project root to its canonical absolute path so symlink aliases
 * (such as `/tmp` vs `/private/tmp` on macOS) match the same stored path.
 */
export function canonicalCheckoutPath(projectRoot: string): string {
  const resolved = resolve(projectRoot);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readPersistedCheckoutId(idPath: string): PersistedCheckoutId | null {
  if (!existsSync(idPath)) return null;
  try {
    const raw = readFileSync(idPath, "utf-8").trim();
    if (!raw.startsWith("{")) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCheckoutId>;
    if (
      typeof parsed.id === "string" &&
      CHECKOUT_ID_PATTERN.test(parsed.id) &&
      typeof parsed.path === "string" &&
      parsed.path.length > 0
    ) {
      return {
        id: parsed.id,
        path: parsed.path,
        ...(typeof parsed.hostSuffix === "string" && parsed.hostSuffix.length > 0
          ? { hostSuffix: parsed.hostSuffix }
          : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the file at `idPath` holds content that can never become a checkout
 * record: it is non-empty and does not begin with "{" (a legacy plain-UUID id or
 * a corrupt file). A winner still writing its record is empty or already begins
 * with "{", so it never matches.
 */
function isLegacyOrCorruptRecord(idPath: string): boolean {
  try {
    const raw = readFileSync(idPath, "utf-8").trim();
    return raw.length > 0 && !raw.startsWith("{");
  } catch {
    return false;
  }
}

function generateHexId(avoid?: string): string {
  let id = randomBytes(4).toString("hex");
  while (avoid !== undefined && id === avoid) {
    id = randomBytes(4).toString("hex");
  }
  return id;
}

function deterministicFallbackId(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 8);
}

/**
 * Returns the stable 8-hex-character checkout id for `projectRoot`, creating
 * `.flisk/.project-id` if needed.
 *
 * The file records both the id and the canonical absolute path it was created
 * for. If the recorded path differs from the current path (the folder was
 * copied or moved), a fresh id is generated and persisted so two copies never
 * share one. First-time creation is exclusive (`wx`): when two processes start
 * the same checkout while the file is missing, the one that loses the race
 * adopts the winner's id instead of overwriting it, so both report and inject
 * the same `FLISK_CHECKOUT_ID`.
 */
export function getCheckoutId(projectRoot: string, options: { persist?: boolean } = {}): string {
  const currentPath = canonicalCheckoutPath(projectRoot);
  const idPath = join(projectRoot, CHECKOUT_ID_RELATIVE_PATH);
  const persisted = readPersistedCheckoutId(idPath);

  if (persisted && persisted.path === currentPath) {
    return persisted.id;
  }

  if (options.persist === false) {
    return deterministicFallbackId(currentPath);
  }

  const nextId = generateHexId(persisted?.id);
  const contents = `${JSON.stringify({ id: nextId, path: currentPath })}\n`;
  try {
    mkdirSync(join(projectRoot, ".flisk"), { recursive: true });
    // The record names this machine's path, so it must not be committable wherever it is written.
    ensureCheckoutRecordIgnored(projectRoot);
    if (persisted) {
      // A record for another path (the folder was copied or moved): replace it so this checkout gets its own id.
      writeFileSync(idPath, contents, "utf-8");
    } else {
      try {
        writeFileSync(idPath, contents, { encoding: "utf-8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Another process created the record first: adopt its id so both processes agree. The winner may still be
        // writing its contents (the file exists from the moment the exclusive open created it), so re-read with a
        // short bounded spin: a complete record naming this path is adopted, one naming another path (a copied or
        // moved checkout) is replaced, and a record that is still unreadable is never overwritten — the winner owns
        // it, and the next call on this machine reads the finished record (#4694).
        for (let attempt = 0; ; attempt++) {
          const winner = readPersistedCheckoutId(idPath);
          if (winner) {
            if (winner.path === currentPath) return winner.id;
            writeFileSync(idPath, contents, "utf-8");
            return nextId;
          }
          // A leftover that can never parse as a record is not a winner still writing: replace it so a
          // legacy plain-UUID or corrupt .project-id heals to a path-bound id instead of spinning forever.
          if (isLegacyOrCorruptRecord(idPath)) {
            writeFileSync(idPath, contents, "utf-8");
            return nextId;
          }
          if (attempt >= 200) return deterministicFallbackId(currentPath);
        }
      }
    }
    return nextId;
  } catch {
    return deterministicFallbackId(currentPath);
  }
}

/**
 * True when `.flisk/.project-id` holds a record for this exact path, so every process (the CLI and the Starlark engine)
 * reads the same id. `getCheckoutId` falls back to a derived id when it cannot write the record; the engine reads only
 * the record, so a checkout without one must not start (#4698).
 */
export function isCheckoutIdPersisted(projectRoot: string): boolean {
  const record = readPersistedCheckoutId(join(projectRoot, CHECKOUT_ID_RELATIVE_PATH));
  return record !== null && record.path === canonicalCheckoutPath(projectRoot);
}

/**
 * Returns both the checkout id and sanitized checkout name for `projectRoot`.
 */
export function getCheckoutIdentity(
  projectRoot: string,
  options: { persist?: boolean } = {},
): CheckoutIdentity {
  return {
    id: getCheckoutId(projectRoot, options),
    name: getCheckoutName(projectRoot),
  };
}

/**
 * Returns the environment map (`FLISK_CHECKOUT_ID` and `FLISK_CHECKOUT_NAME`)
 * for `projectRoot`.
 */
export function checkoutEnvVars(
  projectRoot: string,
  options: { persist?: boolean } = {},
): Record<typeof CHECKOUT_ID_ENV | typeof CHECKOUT_NAME_ENV, string> {
  const identity = getCheckoutIdentity(projectRoot, options);
  return {
    [CHECKOUT_ID_ENV]: identity.id,
    [CHECKOUT_NAME_ENV]: identity.name,
  };
}

/** The name `exportCheckoutEnv` last wrote into each target, to tell it apart from a user's override. */
const exportedCheckoutNames = new WeakMap<NodeJS.ProcessEnv, string>();

/**
 * Exports `FLISK_CHECKOUT_ID` and `FLISK_CHECKOUT_NAME` into `target`
 * (defaults to `process.env`) so child processes such as Tilt and Docker Compose
 * inherit them for interpolation.
 */
export function exportCheckoutEnv(
  projectRoot: string,
  target: NodeJS.ProcessEnv = process.env,
): CheckoutIdentity {
  const folderIdentity = getCheckoutIdentity(projectRoot);
  // An incoming FLISK_CHECKOUT_NAME is the user's override (it names the host in `getCheckoutDomain`): keep it.
  // A value this process exported earlier for another checkout is not an override, so it is replaced.
  const override = target[CHECKOUT_NAME_ENV];
  const hasOverride =
    override !== undefined && override !== "" && override !== exportedCheckoutNames.get(target);
  const identity: CheckoutIdentity = {
    id: folderIdentity.id,
    name: hasOverride ? sanitizeCheckoutName(override) : folderIdentity.name,
  };
  target[CHECKOUT_ID_ENV] = identity.id;
  target[CHECKOUT_NAME_ENV] = identity.name;
  exportedCheckoutNames.set(target, identity.name);
  return identity;
}

/**
 * The host suffix recorded for this checkout by `flisk up` after a name collision (#4697).
 * Reading it keeps `flisk status`, `flisk networks` and `flisk open` on the same host as the
 * routes the running stack generated, without requiring the user to carry an env var.
 */
export function readCheckoutHostSuffix(projectRoot: string): string | null {
  const persisted = readPersistedCheckoutId(join(projectRoot, CHECKOUT_ID_RELATIVE_PATH));
  return persisted?.hostSuffix ?? null;
}

/** Persist a short checkout-id prefix in the local (gitignored) checkout record. */
export function setCheckoutHostSuffix(projectRoot: string, suffix: string): void {
  if (!/^-?[a-f0-9]{1,4}$/.test(suffix)) return;
  const idPath = join(projectRoot, CHECKOUT_ID_RELATIVE_PATH);
  const persisted = readPersistedCheckoutId(idPath);
  if (!persisted || persisted.hostSuffix === suffix) return;
  writeFileSync(idPath, `${JSON.stringify({ ...persisted, hostSuffix: suffix })}\n`, "utf-8");
}
