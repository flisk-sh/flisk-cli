// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTAINER_RUNTIME_CHECK } from "../../constants.js";
import { type DoctorCheckFn, isContainerDependentCheck, runChecks } from "../../doctor-runner.js";
import type { ExecAsync } from "../../exec-async.js";
import {
  DOCTOR_WIRING_CHECKS,
  DOCTOR_WIRING_SLOTS,
  type DoctorCheckContext,
  doctorWiringCheckFn,
  wiringChecksFor,
} from "../checks/table.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flisk-doctor-table-"));
  mkdirSync(join(root, ".flisk"), { recursive: true });
  writeFileSync(
    join(root, ".flisk", "project.json"),
    JSON.stringify({ project: { name: "reports-demo" } }),
  );
  // A DB_PASSWORD lets the Postgres credentials check reach the fake runtime's psql probe.
  writeFileSync(join(root, ".env"), "DB_PASSWORD=contract-test-password\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Answers the commands the container-runtime checks issue, like a small Docker daemon. */
const fakeRuntimeExec: ExecAsync = async (command) => {
  if (command.includes("docker network create")) return "";
  if (command.includes("docker network rm")) return "";
  if (command.includes("State.Running")) return "true\n";
  if (command.includes("IPAddress")) return "172.20.0.5 \n";
  if (command.includes("Mounts")) return "reports_demo_postgres_data \n";
  if (command.includes("psql")) return "1\n";
  throw new Error(`unexpected command: ${command}`);
};

const fakeListProcesses = (() => "1 launchd\n") as unknown as typeof execSync;

function context(): DoctorCheckContext {
  return {
    projectRoot: root,
    options: {},
    exec: fakeRuntimeExec,
    listProcesses: fakeListProcesses,
  };
}

describe("doctor wiring check table", () => {
  it("reports a stable, unique, JSON-serializable check name from every row", async () => {
    const seen = new Set<string>();
    for (const spec of DOCTOR_WIRING_CHECKS) {
      const result = await spec.run(context());
      expect(result.name, spec.name).toBe(spec.name);
      expect(seen.has(spec.name), spec.name).toBe(false);
      seen.add(spec.name);
      expect(JSON.parse(JSON.stringify(result)).name, spec.name).toBe(spec.name);
    }
  });

  it("gates exactly the rows whose requires field names the container runtime", () => {
    const checksContext = context();
    for (const spec of DOCTOR_WIRING_CHECKS) {
      const check = doctorWiringCheckFn(spec, checksContext);
      expect(isContainerDependentCheck(check), spec.name).toBe(
        spec.requires === "container-runtime",
      );
    }
  });

  it("skips the container-runtime rows when the runtime failed and runs the rest", async () => {
    const checksContext = context();
    const runtimeDown: DoctorCheckFn = () => ({
      name: CONTAINER_RUNTIME_CHECK,
      didPass: false,
      message: "Docker daemon is not running",
    });
    const results = await runChecks(
      [
        runtimeDown,
        ...DOCTOR_WIRING_CHECKS.map((spec) => doctorWiringCheckFn(spec, checksContext)),
      ],
      { all: true },
    );
    for (const [index, spec] of DOCTOR_WIRING_CHECKS.entries()) {
      const result = results[index + 1];
      if (spec.requires === "container-runtime") {
        expect(result.isSkipped, spec.name).toBe(true);
        expect(result.name, spec.name).toBe(spec.checkName ?? spec.name);
        expect(result.message, spec.name).toContain("Docker not running");
      } else {
        expect(result.name, spec.name).toBe(spec.name);
      }
    }
  });

  it("places every row into a doctor check list through a slot the run consumes", () => {
    const checksContext = context();
    const placed = DOCTOR_WIRING_SLOTS.flatMap((slot) => wiringChecksFor(slot, checksContext));
    expect(placed).toHaveLength(DOCTOR_WIRING_CHECKS.length);
    for (const spec of DOCTOR_WIRING_CHECKS) {
      expect(DOCTOR_WIRING_SLOTS, spec.name).toContain(spec.slot);
    }
  });
});
