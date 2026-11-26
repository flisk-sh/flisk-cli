// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The FliskOS launch surface as pure data builders: where FliskOS lives on this machine, which project it opens and
 * the arguments `fliskos` is started with. Nothing here spawns a process; `launch.ts` turns this data into one.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { FliskError } from "../../utils/errors.js";
import { JsonCommandError } from "../../utils/json-command.js";
import { findProjectRoot } from "../../utils/paths.js";
import { findOnPath } from "../../utils/which.js";

/** The command the FliskOS package installs. */
export const FLISKOS_COMMAND = "fliskos";

/** The npm package that installs it (not published yet). */
export const FLISKOS_PACKAGE = "@flisk-sh/fliskos";

/** The repository FliskOS is built from. */
export const FLISKOS_REPOSITORY = "https://github.com/flisk-sh/fliskos";

/** The name of the macOS app, which is what `open -a` takes. */
export const FLISKOS_APP = "FliskOS";

/** What `flisk os` needs to know about the machine, so a test can describe one without having it. */
export interface FliskOsHost {
  platform: NodeJS.Platform;
  home: string;
  findCommand: (name: string) => string | null;
  exists: (path: string) => boolean;
}

/** The options of `flisk os` as Commander hands them over. */
export interface OsOptions {
  project?: string;
  /** Kept as typed, so a bad value is reported with the text the user wrote. */
  port?: string;
  /** False when `--no-open` was given. */
  open?: boolean;
  scanRoot?: string[];
  json?: boolean;
}

/** Where FliskOS was found: the `fliskos` executable, or the macOS app bundle. */
export interface FliskOsLocation {
  via: "command" | "app";
  path: string;
}

/** What `flisk os --json` reports. */
export interface OsReport {
  /** How FliskOS was started. */
  via: "command" | "app";
  /** The `fliskos` executable, or the app bundle. */
  path: string;
  /** The arguments it was started with (`open`'s, for the app). */
  args: string[];
  /** The Flisk project FliskOS was pointed at, or null when none was passed. */
  project: string | null;
  /**
   * Where FliskOS listens, once the command reported it, exactly as printed. The URL carries FliskOS's access token in
   * its query string, so it is a credential: keep it out of logs. Null for the app, which opens its own window.
   */
  url: string | null;
  /** The options that were given but the app cannot take. Empty for the command. */
  ignored: string[];
}

export function defaultHost(): FliskOsHost {
  return {
    platform: process.platform,
    home: homedir(),
    findCommand: findOnPath,
    exists: existsSync,
  };
}

/** The places `install:mac` puts the app: the system folder when it was writable, else the user's. */
export function appBundles(host: Pick<FliskOsHost, "home">): string[] {
  return [
    `/Applications/${FLISKOS_APP}.app`,
    join(host.home, "Applications", `${FLISKOS_APP}.app`),
  ];
}

/**
 * Finds FliskOS: the `fliskos` command wins, because it takes the project and the other options; the macOS app is the
 * fallback. Returns null when neither is there.
 */
export function locateFliskOs(host: FliskOsHost = defaultHost()): FliskOsLocation | null {
  const command = host.findCommand(FLISKOS_COMMAND);
  if (command) return { via: "command", path: command };
  if (host.platform !== "darwin") return null;
  const app = appBundles(host).find((bundle) => host.exists(bundle));
  return app ? { via: "app", path: app } : null;
}

/** The error for a machine with neither the command nor the app. Nothing is installed on the user's behalf. */
export function notInstalledError(platform: NodeJS.Platform = process.platform): JsonCommandError {
  const isMac = platform === "darwin";
  const where = isMac
    ? `no \`${FLISKOS_COMMAND}\` command on PATH and no ${FLISKOS_APP}.app in /Applications or ~/Applications`
    : `no \`${FLISKOS_COMMAND}\` command on PATH`;
  return new JsonCommandError("FLISKOS_NOT_INSTALLED", `FliskOS is not installed (${where})`, [
    `Install the command once ${FLISKOS_PACKAGE} is published: npm install --global ${FLISKOS_PACKAGE}`,
    isMac
      ? `Or, from a checkout of ${FLISKOS_REPOSITORY}: npm run install:mac (installs ${FLISKOS_APP}.app)`
      : `Or build it from a checkout of ${FLISKOS_REPOSITORY}`,
    "Then run `flisk os` again. flisk never installs it for you.",
  ]);
}

/** Reads `--port` the way `fliskos` does: an integer from 0 (a free port) to 65535. */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value.trim()) || port > 65535) {
    throw new FliskError(`--port must be an integer from 0 to 65535, got "${value}"`, [
      "Pass a port such as --port 4300, or leave it out and FliskOS picks a free one",
    ]);
  }
  return port;
}

/**
 * The project to open: the one at `--project` (an error when it is not a Flisk project), else the one around the
 * current folder, else none, and FliskOS finds the projects itself.
 */
export function resolveOsProject(explicit: string | undefined, cwd: string): string | null {
  if (explicit) {
    const path = resolve(cwd, explicit);
    const root = findProjectRoot(path);
    if (!root) {
      throw new FliskError(`No Flisk project at ${path} (no .flisk/project.json found)`, [
        "Pass the folder of a Flisk project: flisk os --project <path>",
        "Or leave --project out and FliskOS lists the projects it finds",
      ]);
    }
    return root;
  }
  return findProjectRoot(cwd);
}

/** The arguments `fliskos` takes, in the order they are documented. */
export function fliskOsArgs(input: {
  project: string | null;
  port?: number;
  open?: boolean;
  scanRoots?: string[];
}): string[] {
  const args: string[] = [];
  if (input.project) args.push("--project", input.project);
  if (input.port !== undefined) args.push("--port", String(input.port));
  if (input.open === false) args.push("--no-open");
  for (const root of input.scanRoots ?? []) args.push("--scan-root", root);
  return args;
}
