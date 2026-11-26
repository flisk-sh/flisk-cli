// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export interface TiltCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type TiltRuntimeStatus = "running" | "pending" | "error" | "unknown";

export type TiltBuildStatus = "ok" | "error" | "in_progress" | "unknown";

export interface TiltResourceStatus {
  runtimeStatus: TiltRuntimeStatus;
  buildStatus: TiltBuildStatus;
  lastBuildTime: string | null;
  currentBuildTime: string | null;
  available: boolean;
}
