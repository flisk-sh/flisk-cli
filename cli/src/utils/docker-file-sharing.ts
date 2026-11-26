// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { execFile } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../types/index.js";
import type { DockerRunner } from "./docker-build-cache.js";
import {
  type DoctorProbeEnvironment,
  readDoctorProbe,
  writeDoctorProbe,
} from "./doctor-probe-cache.js";
import { isExecTimeout } from "./exec-async.js";
import { findProjectRoot } from "./paths.js";
import { isWsl } from "./platform.js";
import { findOnPath } from "./which.js";

export const DOCKER_FILE_SHARING_CHECK = "Docker File Sharing";
const DOCKER_FILE_SHARING_PROBE = "docker-file-sharing";

/** Default hard deadline for the bind-mount probe; a wedged file share must not stall doctor. */
export const DEFAULT_DOCKER_PROBE_TIMEOUT_MS = 15_000;
/** Grace between SIGTERM and SIGKILL once the probe deadline passes. */
const DOCKER_PROBE_KILL_GRACE_MS = 1_000;

/** True when `runDockerProbe` stopped `docker run` at its deadline rather than letting it hang. */
export function isDockerProbeTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { fliskDockerProbeTimeout?: unknown }).fliskDockerProbeTimeout === true
  );
}

interface ProbeChild {
  kill(signal?: NodeJS.Signals | number): boolean;
}

interface ProbeExecError extends Error {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  fliskDockerProbeTimeout?: boolean;
}

type ProbeExecFile = (
  file: string,
  args: string[],
  options: { encoding: "utf-8"; windowsHide: boolean },
  callback: (error: ProbeExecError | null, stdout: string, stderr: string) => void,
) => ProbeChild;

export interface DockerProbeRunOptions {
  /** Hard deadline for `docker run`; default DEFAULT_DOCKER_PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Injectable process runner for tests. */
  execFileImpl?: ProbeExecFile;
  /**
   * Called after the probe child is killed when doctor itself receives SIGINT/SIGTERM.
   * Defaults to `process.exit` so a bare Ctrl-C keeps its usual exit code.
   */
  onSignal?: (signal: "SIGINT" | "SIGTERM", exitCode: number) => void;
}

/**
 * Runs `docker <args>` under a hard deadline: at `timeoutMs` the child is sent SIGTERM, and after a
 * short grace SIGKILL, because a wedged Docker Desktop can leave `docker run` ignoring SIGTERM.
 * The promise rejects with a `isDockerProbeTimeout` error at the deadline even if the child never
 * exits. While the probe runs, SIGINT/SIGTERM on doctor kill the child first so Ctrl-C does not
 * orphan `docker run`; the signal listeners are removed as soon as the probe settles.
 */
export function runDockerProbe(
  args: string[],
  options: DockerProbeRunOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOCKER_PROBE_TIMEOUT_MS;
  const execFileImpl = options.execFileImpl ?? (execFile as ProbeExecFile);
  const onSignal =
    options.onSignal ??
    ((_signal: "SIGINT" | "SIGTERM", exitCode: number) => process.exit(exitCode));

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let child: ProbeChild | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutError = (): Error => {
      const error: ProbeExecError = new Error(`docker run timed out after ${timeoutMs} ms`);
      error.fliskDockerProbeTimeout = true;
      return error;
    };

    const stopChild = (signal: NodeJS.Signals): void => {
      try {
        child?.kill(signal);
      } catch {
        // Killing an already-dead child is best effort; the deadline still rejects.
      }
    };

    const onSigint = (): void => {
      stopChild("SIGKILL");
      onSignal("SIGINT", 130);
    };
    const onSigterm = (): void => {
      stopChild("SIGKILL");
      onSignal("SIGTERM", 143);
    };

    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      complete();
    };

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const onDeadline = (): void => {
      timedOut = true;
      stopChild("SIGTERM");
      killTimer = setTimeout(() => {
        // A wedged `docker run` can ignore SIGTERM; SIGKILL cannot be caught. Reject now instead of
        // waiting on a 'close' event that may never come.
        stopChild("SIGKILL");
        settle(() => reject(timeoutError()));
      }, DOCKER_PROBE_KILL_GRACE_MS);
    };

    try {
      child = execFileImpl(
        "docker",
        args,
        { encoding: "utf-8", windowsHide: true },
        (error, stdout, stderr) => {
          settle(() => {
            if (timedOut) {
              reject(timeoutError());
            } else if (error) {
              error.stderr ??= stderr;
              error.stdout ??= stdout;
              reject(error);
            } else {
              resolve(stdout);
            }
          });
        },
      );
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    timeoutTimer = setTimeout(onDeadline, timeoutMs);
  });
}

export interface DockerFileSharingOptions {
  projectRoot?: string;
  runner?: DockerRunner;
  hasDocker?: boolean;
  image?: string;
  /** Inside WSL2 the Docker Desktop "File sharing" setting does not apply; defaults to detecting WSL. */
  isWsl?: boolean;
  /** Hard deadline for the bind-mount probe in milliseconds; default DEFAULT_DOCKER_PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Recent probe verdicts remembered per project folder, daemon and server version; absent means always probe. */
  probeEnvironment?: DoctorProbeEnvironment | Promise<DoctorProbeEnvironment>;
}

/**
 * What Docker prints when it refuses the bind mount before the probe starts. A bare "permission denied" is not here: before
 * the container starts it is usually the daemon socket, which says nothing about file sharing.
 */
const MOUNT_DENIED =
  /mounts? denied|not shared from the host|file sharing|invalid mount|bind source path|error while creating mount/i;

/** `docker run` exits 125 when the daemon fails it, 126/127 when the command cannot run: the probe never started. */
const DOCKER_RUN_PRE_START_CODES = new Set([125, 126, 127]);

/**
 * What the docker CLI or daemon prints when no container was started. The CLI exits 1 (not 125) when it cannot reach the
 * daemon, so the exit code alone would read that as the probe's own write failing. The dial/connect tails stay qualified
 * with "connect:" so a project path that merely contains "connection refused" cannot read as a pre-start failure.
 */
const DOCKER_PRE_START =
  /cannot connect to the docker daemon|error during connect|error response from daemon|unable to find image|pull access denied|while trying to connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|dial (?:unix|tcp) .+?: connect|connect: no such file or directory|connect: connection refused/i;

/**
 * Daemon-unreachable wordings, including Docker 28+/29's "failed to connect to the docker API at …". The dial/connect
 * tails keep their "connect:" context: a mount denial echoes the project path, and a path segment can itself read like
 * "connection refused", which must not count as the daemon being unreachable.
 */
const DOCKER_DAEMON_UNREACHABLE =
  /cannot connect to the docker daemon|failed to connect to the docker api|error during connect|is the docker daemon running|dial (?:unix|tcp) .+?: connect|connect: no such file or directory|connect: connection refused/i;

/** True when the probe container started and its write into the mount failed (a read-only or denied mount). */
function probeStartedAndFailed(error: unknown, detail: string): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === "number" &&
    code !== 0 &&
    !DOCKER_RUN_PRE_START_CODES.has(code) &&
    !DOCKER_PRE_START.test(detail)
  );
}

/** The text of a failed `docker run`: its stderr and message, which is where Docker explains why. */
function probeErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const { stderr, message } = error as { stderr?: unknown; message?: unknown };
  return [stderr, message].filter((part) => typeof part === "string" && part).join("\n");
}

/** The non-empty lines of a Docker error on one line, so the cause after "Unable to find image" is not lost. */
function summarizeLines(text: string): string {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].join(" / ");
}

export function formatDockerFileSharingFix(projectFolder: string): string {
  return [
    `Share ${projectFolder} with Docker so bind mounts reach the host:`,
    `  • Docker Desktop: Settings → Resources → File sharing (add ${projectFolder} or its parent)`,
    `  • Colima: start with --mount (e.g. colima start --mount ${projectFolder})`,
    "  • Remote engine: run Flisk directly on that host",
  ].join("\n");
}

/**
 * Verifies that Docker can see files in the project folder through a bind mount.
 * When the folder is not shared (Docker Desktop file sharing disabled, Colima without --mount,
 * or remote Docker engine), a container writing into a bind mount silently writes inside
 * the VM while the host folder remains empty.
 */
export async function checkDockerFileSharing(
  options: DockerFileSharingOptions = {},
): Promise<CheckResult> {
  if (options.isWsl ?? isWsl()) {
    return {
      name: DOCKER_FILE_SHARING_CHECK,
      didPass: true,
      isSkipped: true,
      message:
        "Running in WSL2 - Docker Desktop file sharing does not apply (see Docker WSL integration)",
    };
  }
  const hasDocker = options.hasDocker ?? Boolean(findOnPath("docker"));
  if (!hasDocker) {
    return {
      name: DOCKER_FILE_SHARING_CHECK,
      didPass: true,
      isSkipped: true,
      message: "Docker CLI not found - skipped file sharing check",
    };
  }

  const projectFolder = options.projectRoot ?? findProjectRoot() ?? process.cwd();
  const env = await options.probeEnvironment;
  const cached =
    env &&
    readDoctorProbe(env, DOCKER_FILE_SHARING_PROBE, projectFolder, DOCKER_FILE_SHARING_CHECK);
  if (cached) return cached;
  const result = await runDockerFileSharingProbe(projectFolder, options);
  if (env) writeDoctorProbe(env, DOCKER_FILE_SHARING_PROBE, projectFolder, result);
  return result;
}

async function runDockerFileSharingProbe(
  projectFolder: string,
  options: DockerFileSharingOptions,
): Promise<CheckResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOCKER_PROBE_TIMEOUT_MS;
  const runner = options.runner ?? ((args: string[]) => runDockerProbe(args, { timeoutMs }));
  const image = options.image ?? "alpine";

  const probeName = `.flisk-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const probeHostPath = join(projectFolder, probeName);

  try {
    try {
      await runner([
        "run",
        "--rm",
        "-v",
        `${projectFolder}:/flisk-probe`,
        image,
        "sh",
        "-c",
        `echo 1 > /flisk-probe/${probeName}`,
      ]);
    } catch (error) {
      const probeTimedOut = isDockerProbeTimeout(error) || isExecTimeout(error);
      if (probeTimedOut) {
        const seconds = Math.max(1, Math.round(timeoutMs / 1000));
        if (existsSync(probeHostPath)) {
          // The probe write reached the host, so file sharing works; only the container hung on exit.
          return {
            name: DOCKER_FILE_SHARING_CHECK,
            didPass: true,
            isWarning: true,
            message: `Docker can write to the project folder (${projectFolder}), but the probe container did not exit within ${seconds} s`,
            fix: "Docker Desktop file sharing may be stuck; restarting Docker Desktop usually fixes it",
          };
        }
        // A `docker run` that cannot start a container inside the deadline is a named failure, not a
        // hang: the user can act on it instead of waiting on a stuck check.
        return {
          name: DOCKER_FILE_SHARING_CHECK,
          didPass: false,
          message: `Docker could not start a container with ${projectFolder} mounted: the mount probe timed out after ${seconds} s`,
          fix: `Docker Desktop file sharing may be stuck; restarting Docker Desktop usually fixes it, then retry: flisk doctor`,
        };
      }
      // If docker run fails (e.g. Docker explicitly denies the mount), check if the file was created
      if (!existsSync(probeHostPath)) {
        const detail = probeErrorText(error);
        const daemonUnreachable = DOCKER_DAEMON_UNREACHABLE.test(detail);
        if (
          daemonUnreachable ||
          (!probeStartedAndFailed(error, detail) && !MOUNT_DENIED.test(detail))
        ) {
          // The probe container never ran (the image could not be pulled, the engine refused it, it timed out, or Docker
          // could not reach the daemon), so this says nothing about file sharing. Reporting it as a sharing failure sent
          // WSL2 users to a setting that does not apply to them while their bind mounts worked.
          const cause = daemonUnreachable
            ? "Docker daemon is unreachable"
            : "Could not run the file sharing probe";
          return {
            name: DOCKER_FILE_SHARING_CHECK,
            didPass: true,
            isSkipped: true,
            message: `${cause} (${summarizeLines(detail) || "docker run failed"}); file sharing was not tested`,
          };
        }
        return {
          name: DOCKER_FILE_SHARING_CHECK,
          didPass: false,
          message: `Docker cannot access the project folder: ${projectFolder}`,
          fix: formatDockerFileSharingFix(projectFolder),
        };
      }
    }

    if (!existsSync(probeHostPath)) {
      return {
        name: DOCKER_FILE_SHARING_CHECK,
        didPass: false,
        message: `Docker cannot see the project folder: ${projectFolder} (bind mounts silently stay inside the VM)`,
        fix: formatDockerFileSharingFix(projectFolder),
      };
    }

    return {
      name: DOCKER_FILE_SHARING_CHECK,
      didPass: true,
      message: `Docker can access the project folder (${projectFolder})`,
    };
  } finally {
    if (existsSync(probeHostPath)) {
      try {
        unlinkSync(probeHostPath);
      } catch {
        // Probe file cleanup is best-effort
      }
    }
  }
}
