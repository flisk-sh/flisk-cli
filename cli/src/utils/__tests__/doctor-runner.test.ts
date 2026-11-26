import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../types/index.js";
import { CONTAINER_RUNTIME_CHECK } from "../constants.js";
import {
  type DoctorCheckFn,
  formatDoctorSummary,
  orderDoctorResults,
  requiresContainerRuntime,
  runChecks,
} from "../doctor-runner.js";

const pass = (name: string): CheckResult => ({ name, didPass: true, message: "ok" });
const fail = (name: string, message = "bad"): CheckResult => ({ name, didPass: false, message });

describe("doctor runner", () => {
  it("stops at the first failure unless all is set", async () => {
    const checks: DoctorCheckFn[] = [() => pass("a"), () => fail("b"), () => pass("c")];
    expect((await runChecks(checks)).map((r) => r.name)).toEqual(["a", "b"]);
    expect((await runChecks(checks, { all: true })).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("skips container checks after the container runtime check fails", async () => {
    const checks: DoctorCheckFn[] = [
      () => fail(CONTAINER_RUNTIME_CHECK),
      requiresContainerRuntime("Service Health", () => pass("Service Health")),
      () => pass("Bun"),
    ];
    const results = await runChecks(checks, { all: true });
    expect(results[1]).toMatchObject({ name: "Service Health", isSkipped: true, didPass: true });
    expect(results[2]).toMatchObject({ name: "Bun", didPass: true });
  });

  it("starts independent --all checks together, defers Docker checks, and keeps input order", async () => {
    const events: string[] = [];
    const probe =
      (name: string, delayMs: number): DoctorCheckFn =>
      async () => {
        events.push(`start:${name}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { name, didPass: true, message: "ok" };
      };
    const results = await runChecks(
      [
        probe("a", 30),
        async () => {
          events.push("start:runtime");
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { name: CONTAINER_RUNTIME_CHECK, didPass: true, message: "Docker up" };
        },
        requiresContainerRuntime("Docker OS", async () => {
          events.push("start:os");
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { name: "Docker OS", didPass: true, message: "ok" };
        }),
        probe("b", 20),
      ],
      { all: true },
    );
    // a, the runtime check and b are independent and all start before any finishes; the
    // container-dependent check waits for the runtime result. Result order is the input order.
    expect(events.slice(0, 3)).toEqual(["start:a", "start:runtime", "start:b"]);
    expect(results.map((result) => result.name)).toEqual([
      "a",
      CONTAINER_RUNTIME_CHECK,
      "Docker OS",
      "b",
    ]);
    expect(results.every((result) => !result.isSkipped)).toBe(true);
  });

  it("orders failures first with a 5432 host port conflict at the top", () => {
    const ordered = orderDoctorResults([
      pass("Bun"),
      fail("Ingress Ports"),
      fail("Host Ports", "port 5432 busy"),
      fail("Other"),
    ]);
    expect(ordered.map((r) => r.name)).toEqual(["Host Ports", "Ingress Ports", "Other", "Bun"]);
  });

  it("summarises counts, adding warnings only when present", () => {
    const warn: CheckResult = { name: "w", didPass: true, isWarning: true, message: "" };
    expect(formatDoctorSummary([pass("a"), fail("b")])).toBe("1 passed, 1 failed, 0 skipped");
    expect(formatDoctorSummary([pass("a"), warn])).toBe("1 passed, 1 warned, 0 failed, 0 skipped");
  });
});
