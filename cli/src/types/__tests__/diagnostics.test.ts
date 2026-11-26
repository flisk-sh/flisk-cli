// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type {
  CheckResult,
  DoctorAction,
  DoctorActionStatus,
  HostPortPlan,
  JsonCommandResult,
  MachineError,
  PortOccupant,
  PortOwnerDetails,
  ValidationResult,
} from "../diagnostics.js";

describe("diagnostics types", () => {
  it("shapes a check result with structured observations", () => {
    const observed: PortOwnerDetails = {
      ownerType: "docker",
      port: 4100,
      container: "demo-db-1",
    };
    const result: CheckResult = {
      name: "Ports",
      durationMs: 12,
      didPass: false,
      message: "port busy",
      fix: "free the port",
      isSkipped: false,
      isWarning: false,
      observed,
    };
    expect(result.didPass).toBe(false);
    expect((result.observed as PortOwnerDetails).container).toBe("demo-db-1");
  });

  it("shapes a doctor --fix action and its statuses", () => {
    const statuses: DoctorActionStatus[] = ["planned", "applied", "skipped", "failed"];
    const action: DoctorAction = {
      id: "a1",
      check: "Ports",
      scope: "project",
      command: "flisk down",
      status: statuses[0] as DoctorActionStatus,
      reason: "port busy",
    };
    expect(statuses).toContain(action.status);
    expect(action.scope).toBe("project");
  });

  it("shapes the host port plan and machine-readable command output", () => {
    const plan: HostPortPlan = {
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      tiltUi: 10350,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: true, ingressHttps: true, postgres: true },
      reason: { ingressHttp: "flag", ingressHttps: "flag", postgres: "flag" },
    };
    const error: MachineError = { code: "PORT_BUSY", message: "busy", suggestions: ["free it"] };
    const result: JsonCommandResult = { data: { plan }, errors: [error], exitCode: 1 };
    expect(result.exitCode).toBe(1);
    expect((result.data as { plan: HostPortPlan }).plan.tiltUi).toBe(10350);
  });

  it("shapes a port occupant and a validation result", () => {
    const occupant: PortOccupant = { pid: 0, command: "postgres", container: "demo-db-1" };
    const ok: ValidationResult = { valid: true };
    const bad: ValidationResult = { valid: false, error: "empty name" };
    expect(occupant.pid).toBe(0);
    expect(ok.valid).toBe(true);
    expect(bad.error).toBe("empty name");
  });
});
