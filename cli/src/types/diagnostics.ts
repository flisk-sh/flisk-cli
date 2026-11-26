// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface PortOwnerDetails {
  ownerType: "docker" | "process";
  port: number;
  container?: string;
  name?: string;
  image?: string;
  process?: string;
  command?: string;
  pid?: number;
  setting?: string;
  [key: string]: unknown;
}

export interface CheckResult {
  name: string;
  durationMs?: number;
  didPass: boolean;
  message: string;
  fix?: string;
  /** Check could not run meaningfully (e.g. nothing started yet); not a failure. */
  isSkipped?: boolean;
  /** Informational warning that does not fail the check unless strict mode is enabled. */
  isWarning?: boolean;
  /** Structured observed metadata (e.g. busy port owner, process, or container) for machine reports. */
  observed?: PortOwnerDetails | unknown;
}

export type DoctorActionStatus = "planned" | "applied" | "skipped" | "failed";

/** One repair `flisk doctor --fix` plans or performs. Part of the `--json` report (`data.actions`). */
export interface DoctorAction {
  id: string;
  check: string;
  /**
   * `project`: owned by the current project. `probe`: a doctor probe, owned by no project. `machine`: another
   * Flisk project's resource, only ever planned with `--scope=machine`. `host`: a cache shared by every project
   * (Docker build cache, dangling images), only planned while free disk space is low.
   */
  scope: "project" | "probe" | "machine" | "host";
  /** The exact command a user could run by hand. */
  command: string;
  status: DoctorActionStatus;
  reason: string;
}

export interface HostPortPlan {
  ingressHttp: number;
  ingressHttps: number;
  postgres: number;
  tiltUi?: number;
  requested: { ingressHttp: number; ingressHttps: number; postgres: number };
  explicit: {
    ingressHttp: boolean;
    ingressHttps: boolean;
    postgres: boolean;
  };
  reason: { ingressHttp: string; ingressHttps: string; postgres: string };
}

/** What a `--json` action reports: its data, any errors, and a non-zero exit code when the report is a failure. */
export interface JsonCommandResult {
  data: unknown;
  errors?: MachineError[];
  exitCode?: number;
}

export interface MachineError {
  code: string;
  message: string;
  suggestions?: string[];
}

export interface PortOccupant {
  pid: number;
  /** The program's name, without its directory (`postgres`, not `/opt/homebrew/bin/postgres`). */
  command: string;
  /** Set when a Docker container publishes the port: its name. Then `pid` is 0, since the host process is Docker's. */
  container?: string;
}
