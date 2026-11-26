// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  alreadyRunningReport,
  describe,
  expect,
  it,
  secondUpAction,
} from "../../test-support/up.js";

describe("second flisk up", () => {
  it("reports the environment already running instead of starting another Tilt", () => {
    expect(secondUpAction({ runningPorts: [10350], force: false, only: false })).toEqual({
      action: "already-running",
      ports: [10350],
    });
  });

  it("says a running stack is healthy only when its resources are", () => {
    expect(alreadyRunningReport(10350, { ready: true, failures: [], timedOut: false })).toEqual({
      ok: true,
      message: "Environment is already running on port 10350.",
    });
  });

  it("reports the failure of a Tilt that an earlier failed flisk up left running", () => {
    // Seen 2026-11-10: `flisk up` failed at init-networks, its Tilt stayed up, and the next `flisk up --wait`
    // printed "Stack is healthy" in 2 s while `flisk status` showed 0/5 healthy.
    const report = alreadyRunningReport(10350, {
      ready: false,
      failures: [{ name: "init-networks", message: "error/none" }],
      timedOut: false,
    });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.code).toBe("UP_RESOURCE_FAILED");
    expect(report.message).toContain("port 10350 is not healthy (init-networks: error/none)");
    expect(report.suggestions.join("\n")).toContain("flisk down && flisk up");
  });

  it("does not call a stack that is still building healthy", () => {
    const report = alreadyRunningReport(10350, {
      ready: false,
      failures: [],
      timedOut: true,
      stillBuilding: ["orders-api"],
    });
    expect(report).toMatchObject({ ok: false, code: "UP_TIMEOUT" });
    if (!report.ok) expect(report.message).toContain("still starting (orders-api still building)");
  });

  it("still blocks --only against a running Tilt", () => {
    expect(secondUpAction({ runningPorts: [10350], force: false, only: true })).toEqual({
      action: "only-blocked",
      ports: [10350],
    });
  });

  it("starts when nothing is running or --force is set", () => {
    expect(secondUpAction({ runningPorts: [], force: false, only: false })).toEqual({
      action: "start",
    });
    expect(secondUpAction({ runningPorts: [10350], force: true, only: false })).toEqual({
      action: "start",
    });
  });
});
