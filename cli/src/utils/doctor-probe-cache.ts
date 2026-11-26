// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CheckResult } from "../types/index.js";
import { dockerDaemonIdentity } from "./docker-build-cache.js";
import {
  DOCKER_SERVER_JSON_COMMAND,
  EXEC_TIMEOUT_MS,
  parseDockerServerJson,
} from "./doctor-tools.js";
import type { ExecAsync } from "./exec-async.js";

/**
 * The bind-mount and network probes cost about a second and answer what one project folder on one Docker install
 * rarely changes between runs, so a fresh verdict is trusted for a few minutes (`flisk doctor --no-probe-cache`
 * re-runs the probes anyway).
 */
export const DOCTOR_PROBE_TTL_MS = 10 * 60 * 1000;

const DOCTOR_PROBE_STAMP = "doctor-probes.json";

/** Appended to a check message when the verdict comes from the stamp file instead of a live probe. */
export const CACHED_MARK = " (cached)";

/** What a probe verdict needs before it can be trusted again on a later run. */
export interface DoctorProbeEnvironment {
  /** Which Docker daemon the probes ran against: DOCKER_HOST plus the current docker context. */
  daemon: string;
  /** The Docker server version the probes ran against; empty when `docker version` could not be read. */
  version: string;
  /** False under `--no-probe-cache`: nothing is read from or written to the stamp file. */
  enabled: boolean;
  /** Home directory holding `.flisk/`; tests pass a temp dir. */
  home: string;
  /** Clock; tests inject one. */
  now: () => number;
}

export interface DoctorProbeEnvironmentOptions {
  enabled?: boolean;
  env?: Record<string, string | undefined>;
  home?: string;
  now?: () => number;
}

/**
 * Builds the identity a probe verdict is remembered under: the daemon identity (DOCKER_HOST and the current
 * context) plus the server version, so a Docker update or a context switch re-runs the probes. The server section
 * comes from the same `docker version` call the version checks share, so this costs nothing extra on a run.
 */
export async function createDoctorProbeEnvironment(
  exec: ExecAsync,
  options: DoctorProbeEnvironmentOptions = {},
): Promise<DoctorProbeEnvironment> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  let version = "";
  try {
    const raw = String(await exec(DOCKER_SERVER_JSON_COMMAND, EXEC_TIMEOUT_MS)).trim();
    version = parseDockerServerJson(raw)?.version ?? raw;
  } catch {
    // The daemon identity already separates engines; an unreadable version just keys the verdict under "".
  }
  return {
    daemon: dockerDaemonIdentity(env, home),
    version,
    enabled: options.enabled ?? true,
    home,
    now: options.now ?? Date.now,
  };
}

interface StoredProbeResult {
  didPass: boolean;
  isWarning?: boolean;
  message: string;
  fix?: string;
}

interface DoctorProbeStamp {
  checkedAt: number;
  key: string;
  result: StoredProbeResult;
}

interface DoctorProbeFile {
  version: 1;
  probes: Record<string, DoctorProbeStamp>;
}

function stampPath(home: string): string {
  return join(home, ".flisk", DOCTOR_PROBE_STAMP);
}

function probeKey(env: DoctorProbeEnvironment, scope: string): string {
  return `${env.daemon}|${env.version}|${scope}`;
}

function readStampFile(home: string): DoctorProbeFile {
  try {
    const raw = JSON.parse(readFileSync(stampPath(home), "utf-8")) as Partial<DoctorProbeFile>;
    if (raw && typeof raw === "object" && raw.probes && typeof raw.probes === "object") {
      return { version: 1, probes: raw.probes };
    }
  } catch {
    // No stamp, or an unreadable one: the probes run.
  }
  return { version: 1, probes: {} };
}

/**
 * The remembered verdict for `probe` when it was stored for this daemon, version and scope within
 * DOCTOR_PROBE_TTL_MS; undefined otherwise. `name` is the CheckResult.name the check reports.
 */
export function readDoctorProbe(
  env: DoctorProbeEnvironment,
  probe: string,
  scope: string,
  name: string,
): CheckResult | undefined {
  if (!env.enabled) return undefined;
  const entry = readStampFile(env.home).probes[probe];
  if (!entry || entry.key !== probeKey(env, scope)) return undefined;
  const age = env.now() - entry.checkedAt;
  if (!(age >= 0 && age < DOCTOR_PROBE_TTL_MS)) return undefined;
  const { result } = entry;
  if (typeof result?.didPass !== "boolean" || typeof result?.message !== "string") return undefined;
  return {
    name,
    didPass: result.didPass,
    isWarning: result.isWarning,
    message: `${result.message}${CACHED_MARK}`,
    fix: result.fix,
  };
}

/**
 * Remembers a probe verdict for this daemon, version and scope. Skipped verdicts are never stored: they mean the
 * probe did not run, so the next run should try again. Best effort; the synchronous section keeps two checks in
 * one run from losing each other's entry.
 */
export function writeDoctorProbe(
  env: DoctorProbeEnvironment,
  probe: string,
  scope: string,
  result: CheckResult,
): void {
  if (!env.enabled || result.isSkipped) return;
  try {
    const file = readStampFile(env.home);
    file.probes[probe] = {
      checkedAt: env.now(),
      key: probeKey(env, scope),
      result: {
        didPass: result.didPass,
        isWarning: result.isWarning,
        message: result.message,
        fix: result.fix,
      },
    };
    const dir = join(env.home, ".flisk");
    mkdirSync(dir, { recursive: true });
    const target = stampPath(env.home);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, target);
  } catch {
    // Without a stamp the next run simply probes again.
  }
}

/** Drops every remembered probe verdict; `flisk doctor --fix` calls this so the next run re-probes what it changed. */
export function clearDoctorProbes(home: string = homedir()): void {
  try {
    rmSync(stampPath(home), { force: true });
  } catch {
    // A leftover stamp only means one more probe verdict is reused.
  }
}
