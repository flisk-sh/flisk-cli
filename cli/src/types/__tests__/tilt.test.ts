// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  TiltBuildStatus,
  TiltCommandResult,
  TiltResourceStatus,
  TiltRuntimeStatus,
} from "../tilt.js";

describe("Tilt runtime types", () => {
  it("shapes a tilt invocation result", () => {
    const result: TiltCommandResult = { exitCode: 1, stdout: "out", stderr: "err" };
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("err");
  });

  it("tracks a resource's runtime and build status", () => {
    const status: TiltResourceStatus = {
      runtimeStatus: "running" satisfies TiltRuntimeStatus,
      buildStatus: "in_progress" satisfies TiltBuildStatus,
      lastBuildTime: "2026-01-01T00:00:00Z",
      currentBuildTime: null,
      available: true,
    };
    expect(status.runtimeStatus).toBe("running");
    expect(status.buildStatus).toBe("in_progress");
    expect(status.currentBuildTime).toBeNull();
  });
});
