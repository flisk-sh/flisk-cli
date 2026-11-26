// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  checkIngressPorts as doctorCheckIngressPorts,
  checkPrivateNpmRegistry as doctorCheckPrivateNpmRegistry,
  checkTiltResourceHealth as doctorCheckTiltResourceHealth,
  summarizeServiceProbes as doctorSummarizeServiceProbes,
  summarizeTiltBuildError as doctorSummarizeTiltBuildError,
} from "../../commands/doctor.js";
import * as processChecks from "../doctor/process.js";
import * as tiltRuntime from "../doctor/tilt-runtime.js";
import type {
  MissingHealthRoute,
  PublishedPortHolder,
  TiltResourceFailure,
} from "../doctor-runtime.js";
import * as doctorRuntime from "../doctor-runtime.js";

// Shared between the two doctor/ modules but never part of the public surface
// that utils/doctor-runtime.js re-exports.
const INTERNAL_EXPORTS = new Set(["EXEC_TIMEOUT_MS", "runHostCommand"]);

describe("doctor-runtime facade", () => {
  it("re-exports the same bindings the doctor/ modules define", () => {
    const sources = { ...processChecks, ...tiltRuntime };
    for (const [name, value] of Object.entries(doctorRuntime)) {
      expect(
        (sources as Record<string, unknown>)[name],
        `facade export ${name} is not the doctor/ module binding`,
      ).toBe(value);
    }
  });

  it("keeps every doctor/ check reachable through the legacy import path", () => {
    for (const module of [processChecks, tiltRuntime]) {
      for (const [name, value] of Object.entries(module)) {
        if (INTERNAL_EXPORTS.has(name)) continue;
        expect(
          (doctorRuntime as Record<string, unknown>)[name],
          `${name} is not re-exported by utils/doctor-runtime.js`,
        ).toBe(value);
      }
    }
  });

  it("keeps the public types importable through the legacy path", () => {
    const failure: TiltResourceFailure = {
      name: "api",
      updateStatus: "error",
      runtimeStatus: "none",
      error: "boom",
    };
    const holder: PublishedPortHolder = { name: "traefik", ports: "", publishedPorts: [80] };
    const missing: MissingHealthRoute = {
      name: "api",
      healthPath: "/health",
      usedBy: "container healthcheck",
    };
    expect([failure.name, holder.name, missing.name]).toEqual(["api", "traefik", "api"]);
  });

  it("delegates the doctor.ts re-exports to the new modules", () => {
    expect(doctorCheckTiltResourceHealth).toBe(tiltRuntime.checkTiltResourceHealth);
    expect(doctorCheckIngressPorts).toBe(processChecks.checkIngressPorts);
    expect(doctorCheckPrivateNpmRegistry).toBe(processChecks.checkPrivateNpmRegistry);
    expect(doctorSummarizeServiceProbes).toBe(processChecks.summarizeServiceProbes);
    expect(doctorSummarizeTiltBuildError).toBe(tiltRuntime.summarizeTiltBuildError);
  });
});
