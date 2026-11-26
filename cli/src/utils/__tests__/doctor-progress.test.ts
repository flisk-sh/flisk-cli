// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../types/index.js";
import { createDoctorProgress } from "../doctor-progress.js";
import { collectDoctorChecks } from "../doctor-report.js";
import {
  type DoctorCheckFn,
  doctorCheckName,
  namedCheck,
  prettyCheckFunctionName,
  requiresContainerRuntime,
  runChecks,
} from "../doctor-runner.js";

const pass = (name: string): CheckResult => ({ name, didPass: true, message: "ok" });

describe("doctorCheckName", () => {
  it("prefers checkName, then the container map, then a pretty function name", () => {
    const named = namedCheck("Explicit", async () => pass("Explicit"));
    expect(doctorCheckName(named)).toBe("Explicit");

    const wrapped = requiresContainerRuntime("Docker File Sharing", async () => pass("x"));
    expect(doctorCheckName(wrapped)).toBe("Docker File Sharing");

    async function checkDockerOperatingSystem(): Promise<CheckResult> {
      return pass("x");
    }
    expect(doctorCheckName(checkDockerOperatingSystem)).toBe("Docker OS");

    async function checkSomethingCustom(): Promise<CheckResult> {
      return pass("x");
    }
    expect(doctorCheckName(checkSomethingCustom)).toBe("Something Custom");
  });

  it("prefers progressName over checkName", () => {
    const check = namedCheck("Inner", async () => pass("x"));
    check.progressName = "Outer";
    expect(doctorCheckName(check)).toBe("Outer");
  });

  it("falls back to a generic label for anonymous checks", () => {
    expect(doctorCheckName(async () => pass("x"))).toBe("Doctor check");
  });
});

describe("prettyCheckFunctionName", () => {
  it("spreads camelCase and only renames check-prefixed functions", () => {
    expect(prettyCheckFunctionName("checkLocalServiceDependencies")).toBe(
      "Local Service Dependencies",
    );
    expect(prettyCheckFunctionName("checkBun")).toBe("Bun");
    expect(prettyCheckFunctionName("notACheck")).toBeUndefined();
    expect(prettyCheckFunctionName("check")).toBeUndefined();
    expect(prettyCheckFunctionName("")).toBeUndefined();
    expect(prettyCheckFunctionName(undefined)).toBeUndefined();
  });
});

describe("createDoctorProgress", () => {
  const checks = (): { a: DoctorCheckFn; b: DoctorCheckFn } => ({
    a: namedCheck("Docker Network Pool", async () => pass("Docker Network Pool")),
    b: namedCheck("Tilt CLI", async () => pass("Tilt CLI")),
  });

  it("plain mode prints a start line and a result line per check", () => {
    const out: string[] = [];
    const progress = createDoctorProgress({ write: (t) => out.push(t), redraw: false });
    const { a, b } = checks();

    progress.onCheckStart(a);
    progress.onCheckStart(b);
    progress.onCheckFinish(a, { name: "Docker Network Pool", didPass: true, message: "ok" });
    progress.onCheckFinish(b, { name: "Tilt CLI", didPass: false, message: "bad" });
    progress.finish();

    const text = out.join("");
    expect(text).toContain("Checking Docker Network Pool");
    expect(text).toContain("Checking Tilt CLI");
    expect(text).toContain("✓ Docker Network Pool");
    expect(text).toContain("✗ Tilt CLI");
  });

  it("plain mode marks warnings, skips and internal errors", () => {
    const out: string[] = [];
    const progress = createDoctorProgress({ write: (t) => out.push(t), redraw: false });
    const { a, b } = checks();
    const c = namedCheck("Colima", async () => pass("x"));

    progress.onCheckStart(a);
    progress.onCheckFinish(a, {
      name: "Docker Network Pool",
      didPass: false,
      isWarning: true,
      message: "w",
    });
    progress.onCheckStart(b);
    progress.onCheckFinish(b, { name: "Tilt CLI", didPass: true, isSkipped: true, message: "s" });
    progress.onCheckStart(c);
    progress.onCheckFinish(c); // threw: no result

    const text = out.join("");
    expect(text).toContain("⚠ Docker Network Pool");
    expect(text).toContain("○ Tilt CLI");
    expect(text).toContain("✗ Colima");
  });

  it("redraw mode keeps one live line listing the checks still running", () => {
    const out: string[] = [];
    const progress = createDoctorProgress({
      write: (t) => out.push(t),
      redraw: true,
      columns: 120,
    });
    const { a, b } = checks();

    progress.onCheckStart(a);
    progress.onCheckStart(b);
    progress.onCheckFinish(a, pass("Docker Network Pool"));

    const live = out.filter((t) => t.includes("⏳"));
    expect(live.length).toBeGreaterThan(0);
    const last = live[live.length - 1] ?? "";
    expect(last).toContain("Tilt CLI");
    expect(last).not.toContain("Docker Network Pool");

    progress.onCheckFinish(b, pass("Tilt CLI"));
    progress.finish();
    expect(out[out.length - 1]).toBe("\r\x1b[2K");
  });

  it("redraw mode truncates the pending list to the terminal width", () => {
    const out: string[] = [];
    const progress = createDoctorProgress({ write: (t) => out.push(t), redraw: true, columns: 30 });
    for (const name of ["Alpha Alpha Alpha", "Beta Beta Beta", "Gamma Gamma Gamma"]) {
      progress.onCheckStart(namedCheck(name, async () => pass(name)));
    }
    const last = out[out.length - 1] ?? "";
    expect(last.replace("\r\x1b[2K", "").length).toBeLessThanOrEqual(29);
    expect(last).toContain("…");
  });
});

describe("check progress hooks", () => {
  it("collectDoctorChecks emits finishes as each check settles, not after all settle", async () => {
    // A finish must reach the progress reporter while slower checks are still running; waiting for
    // allSettled first would keep a hung check's section silent.
    const events: string[] = [];
    let slowDone = false;
    const slow = namedCheck("Slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      slowDone = true;
      return pass("Slow");
    });
    const fast = namedCheck("Fast", async () => pass("Fast"));
    const boom = namedCheck("Boom", async () => {
      throw new Error("boom");
    });

    const progress = {
      onCheckStart: (check: DoctorCheckFn) => events.push(`start:${doctorCheckName(check)}`),
      onCheckFinish: (check: DoctorCheckFn, result?: CheckResult) =>
        events.push(
          `finish:${result?.name ?? doctorCheckName(check)}${slowDone ? "" : " (Slow pending)"}`,
        ),
    };

    const { checks, errors } = await collectDoctorChecks([slow, fast], [boom], progress);

    expect(events).toContain("finish:Fast (Slow pending)");
    expect(events).toContain("finish:Slow");
    expect(events).toContain("finish:Boom");
    expect(checks).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("boom");
  });

  it("runChecks emits start and finish in order and forwards failures", async () => {
    const events: string[] = [];
    const first = namedCheck("First", async () => pass("First"));
    const second = namedCheck("Second", async () => ({
      name: "Second",
      didPass: false,
      message: "no",
    }));

    const results = await runChecks([first, second], {
      all: true,
      onCheckStart: (check) => events.push(`start:${doctorCheckName(check)}`),
      onCheckFinish: (_check, result) => events.push(`finish:${result?.name ?? "?"}`),
    });

    // `--all` starts independent checks together, so both starts fire before either finish.
    expect(events).toEqual(["start:First", "start:Second", "finish:First", "finish:Second"]);
    expect(results).toHaveLength(2);
  });

  it("runChecks reports the finish before rethrowing a crashed check", async () => {
    const events: string[] = [];
    const boom = namedCheck("Boom", async () => {
      throw new Error("exploded");
    });
    const quiet: DoctorCheckFn = async () => pass("quiet");
    quiet.checkName = "After";

    await expect(
      runChecks([boom, quiet], {
        onCheckStart: (check) => events.push(`start:${doctorCheckName(check)}`),
        onCheckFinish: (_check, result) => events.push(`finish:${result?.name ?? "?"}`),
      }),
    ).rejects.toThrow("exploded");
    expect(events).toEqual(["start:Boom", "finish:?"]);
  });
});
