// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckResult, HostPortPlan } from "../../../types/index.js";
import { CONTAINER_RUNTIME_CHECK } from "../../../utils/constants.js";
import { DOCTOR_WIRING_CHECKS, DOCTOR_WIRING_SLOTS } from "../../../utils/doctor/checks/table.js";
import type { DoctorProbeEnvironment } from "../../../utils/doctor-probe-cache.js";
import {
  type DoctorCheckFn,
  isContainerDependentCheck,
  runChecks,
} from "../../../utils/doctor-runner.js";
import { createHostCommandCache } from "../../../utils/host-command-cache.js";
import { crashLoopingContainersCheck } from "../checks/crashloop.js";
import { hostPortsCheck, ingressPortsCheck } from "../checks/host-ports.js";
import { CONTAINER_MACHINE_CHECKS, nativeMachineChecks } from "../checks/machine.js";
import { privateNpmRegistryCheck } from "../checks/npm-registry.js";
import { CONTAINER_PROJECT_CHECKS, nativeProjectChecks } from "../checks/project.js";
import {
  type DoctorCheckSpec,
  type DoctorTableEntry,
  doctorCheckFn,
  isWiringSlotRef,
} from "../checks/spec.js";
import type { DoctorRunContext } from "../context.js";
import { doctorProjectChecks, expandDoctorTable } from "../table.js";

let root: string;
let originalCwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flisk-doctor-check-table-"));
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

const TABLES: Record<string, DoctorTableEntry[]> = {
  "container machine": CONTAINER_MACHINE_CHECKS,
  "native machine": nativeMachineChecks([]),
  "container project": CONTAINER_PROJECT_CHECKS,
  "native project": nativeProjectChecks([]),
};

function stubContext(overrides: Partial<DoctorRunContext> = {}): DoctorRunContext {
  return {
    options: {},
    host: { kind: "local", canUp: true },
    projectRoot: null,
    checkDir: root,
    nativeResources: null,
    includeWslChecks: false,
    gatewayEnabled: false,
    dbEnabled: false,
    portCaps: { gateway: false, database: false },
    hostPortPlan: undefined,
    portPlanError: undefined,
    hostCommandCache: createHostCommandCache(),
    cachedExec: async () => "",
    manifestTypoNotes: () => [],
    probeEnv: async (): Promise<DoctorProbeEnvironment> => ({
      daemon: "",
      version: "",
      enabled: false,
      home: root,
      now: Date.now,
    }),
    dockerProbeTimeout: 15_000,
    diskRuntime: "container",
    execSync: (() => "") as unknown as typeof execSync,
    pingTimeout: 3000,
    pingPort: undefined,
    ...overrides,
  };
}

function specEntries(table: DoctorTableEntry[]): DoctorCheckSpec[] {
  return table.filter((entry): entry is DoctorCheckSpec => !isWiringSlotRef(entry));
}

describe("doctor check table", () => {
  it("gives every row an id, a run body, and a gating flag, with unique names per table", () => {
    for (const [tableName, table] of Object.entries(TABLES)) {
      const seen = new Set<string>();
      for (const entry of table) {
        if (isWiringSlotRef(entry)) {
          expect(DOCTOR_WIRING_SLOTS, `${tableName} wiring slot`).toContain(entry.wiring);
          continue;
        }
        expect(entry.name, `${tableName} row`).toBeTruthy();
        expect(typeof entry.run, `${tableName}: ${entry.name}`).toBe("function");
        expect(["container-runtime", null], `${tableName}: ${entry.name}`).toContain(
          entry.requires,
        );
        if (entry.when !== undefined) {
          expect(typeof entry.when, `${tableName}: ${entry.name}`).toBe("function");
        }
        expect(seen.has(entry.name), `${tableName}: ${entry.name}`).toBe(false);
        seen.add(entry.name);
      }
    }
  });

  it("gates exactly the rows whose requires field names the container runtime", () => {
    const ctx = stubContext();
    for (const [tableName, table] of Object.entries(TABLES)) {
      for (const spec of specEntries(table)) {
        expect(
          isContainerDependentCheck(doctorCheckFn(spec, ctx)),
          `${tableName}: ${spec.name}`,
        ).toBe(spec.requires === "container-runtime");
      }
    }
  });

  it("skips the container-runtime rows with their declared names when the runtime failed", async () => {
    const ctx = stubContext();
    const runtimeDown: DoctorCheckFn = () => ({
      name: CONTAINER_RUNTIME_CHECK,
      didPass: false,
      message: "Docker daemon is not running",
    });
    for (const [tableName, table] of Object.entries(TABLES)) {
      const gated = specEntries(table).filter(
        (spec) => spec.requires === "container-runtime" && (!spec.when || spec.when(ctx)),
      );
      const results = await runChecks(
        [runtimeDown, ...gated.map((spec) => doctorCheckFn(spec, ctx))],
        { all: true },
      );
      for (const [index, spec] of gated.entries()) {
        const result = results[index + 1];
        expect(result.isSkipped, `${tableName}: ${spec.name}`).toBe(true);
        expect(result.name, `${tableName}: ${spec.name}`).toBe(spec.checkName ?? spec.name);
        expect(result.message, `${tableName}: ${spec.name}`).toContain("Docker not running");
      }
    }
  });

  it("expands every table row into a check the run consumes", () => {
    const ctx = stubContext();
    for (const [tableName, table] of Object.entries(TABLES)) {
      const expanded = expandDoctorTable(table, ctx);
      const expectedSpecs = specEntries(table).filter(
        (spec) => !spec.when || spec.when(ctx),
      ).length;
      const expectedWiring = table
        .filter(isWiringSlotRef)
        .reduce(
          (count, ref) =>
            count + DOCTOR_WIRING_CHECKS.filter((spec) => spec.slot === ref.wiring).length,
          0,
        );
      expect(expanded, tableName).toHaveLength(expectedSpecs + expectedWiring);
      for (const check of expanded) {
        expect(typeof check, tableName).toBe("function");
      }
    }
  });

  it("appends the container ping checks last, gated on the container runtime", () => {
    const ctx = stubContext({ options: { ping: true }, pingPort: 8080 });
    const project = doctorProjectChecks(ctx);
    expect(project.slice(-3).map((check) => check.checkName)).toEqual([
      "Service Health",
      "Service Smoke",
      "Advertised Endpoints",
    ]);
    for (const check of project.slice(-3)) {
      expect(isContainerDependentCheck(check)).toBe(true);
    }
  });

  it("appends the native ping check last when the project runs as local processes", () => {
    const ctx = stubContext({ options: { ping: true }, projectRoot: root, nativeResources: [] });
    const project = doctorProjectChecks(ctx);
    expect(project).toHaveLength(expandDoctorTable(nativeProjectChecks([]), ctx).length + 1);
  });

  it("runs the Ignored Names check for a project of local processes too", () => {
    const names = (table: DoctorTableEntry[]): unknown[] =>
      table.map((entry) => "name" in entry && entry.name);
    expect(names(nativeProjectChecks([]))).toContain("Ignored Names");
    expect(names(CONTAINER_PROJECT_CHECKS)).toContain("Ignored Names");
  });

  it("runs the moved check bodies into JSON-serializable results named after their row", async () => {
    process.chdir(root);
    const plan: HostPortPlan = {
      ingressHttp: 8080,
      ingressHttps: 8443,
      postgres: 5433,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "80 taken", ingressHttps: "443 taken", postgres: "5432 taken" },
    };
    const serializable = (result: CheckResult): void => {
      expect(JSON.parse(JSON.stringify(result)).name).toBe(result.name);
    };

    const portsPass = await hostPortsCheck.run(
      stubContext({ hostPortPlan: plan, portCaps: { gateway: true, database: true } }),
    );
    expect(portsPass.name).toBe(hostPortsCheck.name);
    expect(portsPass.didPass).toBe(true);
    serializable(portsPass);

    const portsFail = await hostPortsCheck.run(
      stubContext({ hostPortPlan: undefined, portPlanError: "no free range found" }),
    );
    expect(portsFail.name).toBe(hostPortsCheck.name);
    expect(portsFail.didPass).toBe(false);
    serializable(portsFail);

    const ingress = await ingressPortsCheck.run(stubContext({ hostPortPlan: undefined }));
    expect(ingress.name).toBe(ingressPortsCheck.name);
    expect(ingress.didPass).toBe(false);
    serializable(ingress);

    const registry = await privateNpmRegistryCheck.run(stubContext());
    expect(registry.name).toBe(privateNpmRegistryCheck.name);
    serializable(registry);

    // An unreadable .env skips the crash-loop probe rather than quoting secrets it cannot mask.
    mkdirSync(join(root, ".env"));
    const crash = await crashLoopingContainersCheck.run(stubContext());
    expect(crash.name).toBe(crashLoopingContainersCheck.name);
    expect(crash.isSkipped).toBe(true);
    serializable(crash);
  });
});
