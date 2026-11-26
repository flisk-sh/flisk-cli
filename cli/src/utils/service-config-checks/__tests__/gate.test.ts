// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { FliskError } from "../../errors.js";
import { enforceServiceConfigGate } from "../gate.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-gate-checks-");
const { service } = project;

const exit = (code: number): never => {
  throw new Error(`exit ${code}`);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enforceServiceConfigGate", () => {
  it("lets a valid project through without calling exit", () => {
    const exitSpy = vi.fn() as never;
    service("api");
    service("worker", { port: 4001, dependsOn: ["api"] });
    enforceServiceConfigGate(project.root, {}, exitSpy);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 and reports every failing check, not just the first", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    service("api", { dependsOn: ["worker"], port: 99999 });
    service("worker", { port: 4001, dependsOn: ["api"] });
    let reported = "";
    expect(() =>
      enforceServiceConfigGate(
        project.root,
        { onInvalid: (message) => (reported = message) },
        exit,
      ),
    ).toThrow("exit 1");
    expect(reported).toContain("circular dependency");
    expect(reported).toContain("not an integer from 1 to 65535");
    expect(reported).toContain("Fix:");
  });

  it("sends warning-level results to onWarning and still lets the project through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warnings: string[] = [];
    const exitSpy = vi.fn() as never;
    // Required secrets with FLISK_SECRET_PROVIDER=infisical and no bridge come back as a warning, not an error.
    const saved = process.env.FLISK_SECRET_PROVIDER;
    process.env.FLISK_SECRET_PROVIDER = "infisical";
    try {
      service("api", { secrets: { required: ["A_KEY"] } });
      enforceServiceConfigGate(
        project.root,
        { onWarning: (message) => warnings.push(message) },
        exitSpy,
      );
    } finally {
      if (saved === undefined) delete process.env.FLISK_SECRET_PROVIDER;
      else process.env.FLISK_SECRET_PROVIDER = saved;
    }
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("infisical");
    expect(warn).toHaveBeenCalled();
  });

  it("honors the resources option instead of rediscovering", () => {
    service("api", { port: 99999 });
    const exitSpy = vi.fn() as never;
    enforceServiceConfigGate(project.root, { resources: [] }, exitSpy);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not exit on problems that are only warnings outside the gate", () => {
    // A Postgres 18+ volume at the pre-18 path and a 0.0.0.0 bind are warnings in
    // checkPostgresVolumes and checkNetworkPorts, neither of which the gate runs.
    service("db", {
      appType: "bring-your-own",
      image: "postgres:18-alpine",
      volumes: [{ source: "pgdata", target: "/var/lib/postgresql/data" }],
      extraPorts: [{ port: 5432, bind: "0.0.0.0" }],
    });
    const exitSpy = vi.fn() as never;
    enforceServiceConfigGate(project.root, {}, exitSpy);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("lets an unknown secret provider's FliskError propagate instead of exit(1)", () => {
    const saved = process.env.FLISK_SECRET_PROVIDER;
    process.env.FLISK_SECRET_PROVIDER = "bogus-provider";
    const exitSpy = vi.fn() as never;
    try {
      service("api", { secrets: { required: ["A_KEY"] } });
      expect(() => enforceServiceConfigGate(project.root, {}, exitSpy)).toThrow(FliskError);
    } finally {
      if (saved === undefined) delete process.env.FLISK_SECRET_PROVIDER;
      else process.env.FLISK_SECRET_PROVIDER = saved;
    }
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
