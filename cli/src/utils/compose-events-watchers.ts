// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { knownProjectRoots, lookupProjectTiltUpPids } from "./down-cleanup.js";
import { projectNameAt } from "./project-registry.js";

type CommandRunner = (command: string, args: string[]) => string;

const run: CommandRunner = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf-8",
    stdio: "pipe",
    windowsHide: true,
    // `flisk doctor` runs this scan while Docker is possibly wedged; a hung `docker ps` must not hang the check.
    timeout: 15_000,
  });

/**
 * A live `docker compose ... events --json` process. Tilt's docker_compose integration starts one of these per Compose
 * project it loads, and nothing reaps it: it survives `flisk down`, the containers exiting and the project folder being
 * deleted. Each stream is a pair: the `docker` CLI plus its `docker-compose` plugin child.
 */
export interface ComposeEventsWatcher {
  pid: number;
  command: string;
  /** The stream's `--project-name` (`-p`), when it carries one. */
  projectName?: string;
  /** The stream's `--project-directory`, when it carries one. */
  projectDir?: string;
}

/** The value of `--flag value` or `--flag=value` in a tokenised command line; undefined when the flag is absent or valueless. */
function flagValue(tokens: string[], flag: string): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === flag) {
      const next = tokens[i + 1];
      // A path with a space is reported unquoted by ps, so only the first token is recoverable.
      if (next && !next.startsWith("-")) return next;
    } else if (token.startsWith(`${flag}=`)) {
      const value = token.slice(flag.length + 1);
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Compose's global options that take a value as the next token (`-f path`, `--env-file events`). Their value can look
 * like a subcommand, so it is consumed before the subcommand is chosen. A `--flag=value` form carries its own value.
 */
const COMPOSE_VALUE_OPTIONS = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--project-directory",
  "--env-file",
  "--profile",
  "--parallel",
  "--ansi",
  "--progress",
  "--context",
  "-c",
  "--host",
  "-H",
]);

/**
 * True when a `ps` command line is a Compose event stream: a docker binary (`docker`, `docker-compose`,
 * `com.docker.cli`, a cli-plugins path) running `compose ... events --json`. `docker events` (no `compose` word)
 * and other compose subcommands (`logs`, `ps`, `up`, `exec`) do not match: `events` must be the subcommand itself,
 * found by skipping Compose's global options and their values, not a word that merely appears somewhere (`docker
 * compose exec web events --json`, `docker compose --env-file events run worker --json`).
 */
function isComposeEventsCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  const exe = (tokens[0] ?? "").split("/").pop() ?? "";
  if (!exe.includes("docker")) return false;
  const composeAt = tokens.indexOf("compose");
  if (!exe.includes("compose") && composeAt < 0) return false;
  let at = composeAt >= 0 ? composeAt + 1 : 1;
  while (at < tokens.length) {
    const token = tokens[at] as string;
    if (!token.startsWith("-")) break;
    at += COMPOSE_VALUE_OPTIONS.has(token) ? 2 : 1;
  }
  return tokens[at] === "events" && tokens.slice(at + 1).includes("--json");
}

/**
 * Every Compose event stream on the process table, or null when the platform cannot be asked (`ps` fails, or
 * Windows has none), so a caller can tell "no watchers" from "could not look".
 */
export function listComposeEventsWatchers(
  platform = process.platform,
  commandRunner: CommandRunner = run,
): ComposeEventsWatcher[] | null {
  if (platform === "win32") return null;
  let output: string;
  try {
    output = commandRunner("ps", ["-axo", "pid=,command="]);
  } catch {
    return null;
  }
  const watchers: ComposeEventsWatcher[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S.*)$/.exec(line);
    if (!match) continue;
    const command = match[2] ?? "";
    if (!isComposeEventsCommand(command)) continue;
    const tokens = command.trim().split(/\s+/);
    watchers.push({
      pid: Number(match[1]),
      command,
      projectName: flagValue(tokens, "--project-name") ?? flagValue(tokens, "-p"),
      projectDir: flagValue(tokens, "--project-directory"),
    });
  }
  return watchers;
}

/** A process-table path normalized for comparison: symlinks resolved when the path exists, resolved form otherwise. */
export function resolveWatcherPath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolvePath(dir);
  }
}

/** `dir` is the root itself or lives inside it, comparing resolved paths. */
export function watcherDirInside(dir: string, root: string): boolean {
  const real = resolveWatcherPath(dir);
  const base = resolveWatcherPath(root);
  return real === base || real.startsWith(base + sep);
}

function dirInside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root + sep);
}

/**
 * The event streams this project started: their `--project-directory` is the root or inside it (Compose files under
 * `.flisk/.flisk-out`, `services/<stack>/.autogenerated`, `services/platform/<infra>` or the root itself), and their
 * `--project-name` is this project's `<name>-<stack>-autogenerated` or `<name>-<infra>`. The name prefix alone is not
 * enough: `shop-admin`'s names all start with `shop-`, but its watchers point into `/work/shop-admin`, not `/work/shop`.
 * The directory alone is not enough either: a hand-run Compose session inside the folder is left alone because its
 * project name does not carry this project's name. And a directory inside the root that sits below ANOTHER Flisk
 * project (a worktree or vendored clone, which shares this project's name) belongs to that project, not this one:
 * its nearest `.flisk/project.json` ancestor must be this root.
 */
export function findProjectComposeEventsWatchers(
  projectRoot: string,
  projectName: string,
  platform = process.platform,
  commandRunner: CommandRunner = run,
): ComposeEventsWatcher[] {
  const root = resolveWatcherPath(projectRoot);
  const prefix = `${projectName}-`;
  return (listComposeEventsWatchers(platform, commandRunner) ?? []).filter((watcher) => {
    const name = watcher.projectName;
    if (!name || (name !== projectName && !name.startsWith(prefix))) return false;
    const dir = watcher.projectDir;
    if (!dir) return false;
    const real = resolveWatcherPath(dir);
    if (!dirInside(real, root)) return false;
    // The nearest Flisk project above the directory must be this one, also when the directory itself was deleted: a
    // nested project that shares this name has its own `down`.
    const owner = findFliskProjectRoot(real);
    return owner !== undefined && resolveWatcherPath(owner) === root;
  });
}

/**
 * True when `pid` still belongs to a Compose event stream. Pid numbers are reused: a watcher found earlier may have
 * exited, and a repair must never signal whatever process took the number next.
 */
export function stillComposeEventsWatcher(
  pid: number,
  platform = process.platform,
  commandRunner: CommandRunner = run,
): boolean {
  if (platform === "win32") return false;
  try {
    const output = commandRunner("ps", ["-p", String(pid), "-o", "command="]);
    const command = output.split(/\r?\n/)[0]?.trim() ?? "";
    return isComposeEventsCommand(command);
  } catch {
    return false;
  }
}

/**
 * A short digest of what a watcher is (its command line and project directory), so a repair planned for one pid can tell
 * the same stream from an unrelated one that took the pid number later.
 */
export function watcherIdentity(watcher: ComposeEventsWatcher): string {
  return createHash("sha1")
    .update(`${watcher.command}\0${watcher.projectDir ?? ""}`)
    .digest("hex")
    .slice(0, 8);
}

/** SIGTERM each watcher (the CLI and its plugin child are separate matched pids). Pids already gone are skipped. */
export function stopComposeEventsWatchers(
  watchers: readonly ComposeEventsWatcher[],
  commandRunner: CommandRunner = run,
): number[] {
  const stopped: number[] = [];
  for (const watcher of watchers) {
    try {
      commandRunner("kill", ["-TERM", String(watcher.pid)]);
      stopped.push(watcher.pid);
    } catch {
      // Already gone.
    }
  }
  return stopped;
}

export interface OrphanedEventsWatcher extends ComposeEventsWatcher {
  /** Why the watcher counts as orphaned, in words for reports and repair reasons. */
  gone: string;
  /** The Flisk project root it belongs to, when one could be resolved (for project-scoped repairs). */
  owningRoot?: string;
}

/**
 * Everything the orphan scan needs that it cannot read from the process table itself. `runningProjects` is null when
 * Docker could not be asked, and then nothing proves an orphan: a `ps` `--project-directory` clipped at a space also
 * reads as "deleted", so a live stack's stream could look gone.
 */
export interface EventsWatcherScan {
  watchers: ComposeEventsWatcher[] | null;
  /** Compose project names with at least one running container (`docker ps` labels). */
  runningProjects: Set<string> | null;
  /** Flisk project roots the machine knows; defaults to the project registry. */
  fliskRoots?: readonly string[];
  dirExists?: (dir: string) => boolean;
  /** Nearest ancestor directory holding `.flisk/project.json`; defaults to a real filesystem walk. */
  fliskProjectRoot?: (dir: string) => string | undefined;
  /** `tilt up` pids for a project root's Tiltfile; null when the process table cannot be read. Defaults to the live lookup. */
  tiltPids?: (root: string) => number[] | null;
  /** The name a Flisk project root declares in `.flisk/project.json`; defaults to reading that file. */
  projectNameOf?: (root: string) => string | undefined;
}

/** The Compose file folders only Flisk generates: the engine's output dir and `.autogenerated`. */
function hasFliskDirMarker(dir: string): boolean {
  const normalized = dir.split(sep).join("/");
  return normalized.includes("/.flisk/.flisk-out") || normalized.endsWith("/.autogenerated");
}

/** The nearest directory at or above `dir` holding `.flisk/project.json`, or undefined. */
function findFliskProjectRoot(dir: string): string | undefined {
  let current: string = dir;
  for (;;) {
    if (existsSync(join(current, ".flisk", "project.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * True when the stream provably belongs to a Flisk Compose project: the engine's `*-autogenerated` stack naming, a
 * project directory only Flisk generates, or a project directory inside a Flisk project root (the live tree or one the
 * registry recorded) whose Compose project name carries that project's name (covers `services/platform` infra stacks
 * such as `<project>-database-management`). Directory containment alone proves nothing: a hand-run
 * `docker compose events` session of a user's own project inside a Flisk folder matches the directory but not the name.
 */
function isFliskEventsWatcher(
  watcher: ComposeEventsWatcher,
  roots: readonly string[],
  dirExists: (dir: string) => boolean,
  fliskProjectRoot: (dir: string) => string | undefined,
  projectNameOf: (root: string) => string | undefined,
): boolean {
  if (watcher.projectName?.endsWith("-autogenerated")) return true;
  const dir = watcher.projectDir;
  if (!dir) return false;
  if (hasFliskDirMarker(dir)) return true;
  const owner = owningProjectRoot(watcher, roots, dirExists, fliskProjectRoot);
  if (owner === undefined) return false;
  const projectName = projectNameOf(owner);
  const name = watcher.projectName;
  return (
    projectName !== undefined &&
    name !== undefined &&
    (name === projectName || name.startsWith(`${projectName}-`))
  );
}

/** The Flisk project root owning the watcher's project directory, from the live tree or the registry. */
function owningProjectRoot(
  watcher: ComposeEventsWatcher,
  roots: readonly string[],
  dirExists: (dir: string) => boolean,
  fliskProjectRoot: (dir: string) => string | undefined,
): string | undefined {
  const dir = watcher.projectDir;
  if (!dir) return undefined;
  const real = resolveWatcherPath(dir);
  if (dirExists(real)) {
    const ancestor = fliskProjectRoot(real);
    if (ancestor) return ancestor;
  }
  return roots.find((root) => dirInside(real, resolveWatcherPath(root)));
}

/** A project root's live `tilt up` pids, or null when the process table cannot be read (then nothing proves there is none). */
export function eventsTiltPids(
  root: string,
  platform = process.platform,
  commandRunner: CommandRunner = run,
): number[] | null {
  const pids = lookupProjectTiltUpPids(
    join(root, ".flisk", ".flisk-out", "Tiltfile"),
    platform,
    commandRunner,
  );
  return pids === null ? null : [...new Set(pids)];
}

/**
 * The orphaned streams: Flisk's watchers whose Compose project is gone. A watcher is gone when its project directory
 * was deleted, or when nothing is left that it could still serve - no running container of its Compose project and no
 * `tilt up` for its project. A live `tilt up` or a running container keeps the stream needed: both are checked before
 * the directory, because `ps` reports a `--project-directory` with spaces truncated and a truncated path merely looks
 * deleted. A Docker daemon that cannot be asked proves nothing, so the whole scan is inconclusive then, and a watcher
 * without `--project-directory` can prove nothing either.
 */
export function findOrphanedComposeEventsWatchers(
  scan: EventsWatcherScan,
): OrphanedEventsWatcher[] | null {
  if (scan.watchers === null || scan.runningProjects === null) return null;
  const dirExists = scan.dirExists ?? ((dir: string) => existsSync(dir));
  const roots = scan.fliskRoots ?? knownProjectRoots();
  const fliskProjectRoot = scan.fliskProjectRoot ?? findFliskProjectRoot;
  const tiltPids = scan.tiltPids ?? ((root: string) => eventsTiltPids(root));
  const projectNameOf = scan.projectNameOf ?? projectNameAt;

  const orphans: OrphanedEventsWatcher[] = [];
  for (const watcher of scan.watchers) {
    if (!isFliskEventsWatcher(watcher, roots, dirExists, fliskProjectRoot, projectNameOf)) continue;
    // The owning root resolves from the registry even when the watched folder is gone.
    const owningRoot = owningProjectRoot(watcher, roots, dirExists, fliskProjectRoot);
    const dir = watcher.projectDir;
    if (dir === undefined) continue;
    // Without an owner no Tilt can be looked up, so a directory that no Flisk-only folder name vouches for (`ps` clips a
    // `--project-directory` at a space, `/work/My Projects/shop` reads `/work/My`) proves nothing: leave it alone.
    if (owningRoot === undefined && !hasFliskDirMarker(dir)) continue;
    if (owningRoot) {
      const tilt = tiltPids(owningRoot);
      // A process table that cannot be read says nothing about Tilt: not "none".
      if (tilt === null || tilt.length > 0) continue;
    }
    if (watcher.projectName && scan.runningProjects.has(watcher.projectName)) continue;
    if (!dirExists(dir)) {
      // The folder the stream watches is gone; nothing left can ever reap it.
      orphans.push({ ...watcher, owningRoot, gone: "its project directory is deleted" });
      continue;
    }
    orphans.push({
      ...watcher,
      owningRoot,
      gone: "its compose project has no running containers and no Tilt is up",
    });
  }
  return orphans;
}

/** The live orphan scan: the process table, Docker's running Compose projects, and the project registry. */
export function scanComposeEventsWatchers(
  platform = process.platform,
  commandRunner: CommandRunner = run,
  tiltPids: (root: string) => number[] | null = (root) =>
    eventsTiltPids(root, platform, commandRunner),
): EventsWatcherScan {
  const watchers = listComposeEventsWatchers(platform, commandRunner);
  let runningProjects: Set<string> | null = null;
  try {
    runningProjects = new Set(
      commandRunner("docker", ["ps", "--format", '{{.Label "com.docker.compose.project"}}'])
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    // Docker cannot be asked: nothing proves an orphan then, so the scan reports null downstream.
  }
  return { watchers, runningProjects, tiltPids };
}
