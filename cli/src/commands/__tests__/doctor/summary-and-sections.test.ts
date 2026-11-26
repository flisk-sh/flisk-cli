// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { CheckResult } from "./test-support.js";
import {
  afterEach,
  beforeEach,
  CONTAINER_RUNTIME_CHECK,
  checkWindowsDockerMode,
  checkWindowsHostConfiguration,
  checkWindowsRuntimeTools,
  describe,
  doctorCommand,
  expect,
  formatDoctorSummary,
  it,
  join,
  mkdtempSync,
  renderDoctorOutput,
  requiresContainerRuntime,
  rmSync,
  runChecks,
  tmpdir,
  vi,
  withDoctorCliRun,
} from "./test-support.js";

describe("doctor --all, sections, and summary", () => {
  // --all runs the real machine checks, which shell out to docker, tilt and friends and read ~/.flisk and ~/.docker. Left on the
  // developer's PATH and HOME they take about 4s each and over 30s under load (#2898); an empty PATH and a temporary HOME make
  // every tool "not installed", which these tests already expect (they assert a failing run), in milliseconds.
  const realEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  let isolatedDir = "";
  beforeEach(() => {
    isolatedDir = mkdtempSync(join(tmpdir(), "flisk-doctor-env-"));
    process.env.PATH = isolatedDir;
    process.env.HOME = isolatedDir;
  });
  afterEach(() => {
    if (realEnv.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = realEnv.PATH;
    if (realEnv.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = realEnv.HOME;
    rmSync(isolatedDir, { recursive: true, force: true });
    doctorCommand.setOptionValue("all", false);
    doctorCommand.setOptionValue("json", false);
    doctorCommand.setOptionValue("ping", true);
  });

  it("stops at the first failing check when all is false or omitted", async () => {
    const executed: string[] = [];
    const checks = [
      () => {
        executed.push("first");
        return { name: "First", didPass: true, message: "First passed" };
      },
      () => {
        executed.push("second");
        return { name: "Second", didPass: false, message: "Second failed", fix: "Fix second" };
      },
      () => {
        executed.push("third");
        return { name: "Third", didPass: false, message: "Third failed", fix: "Fix third" };
      },
    ];

    const results = await runChecks(checks, { all: false });

    expect(executed).toEqual(["first", "second"]);
    expect(results).toHaveLength(2);
    expect(results[1]?.name).toBe("Second");
  });

  it("continues past warnings and skipped checks when all is false", async () => {
    const executed: string[] = [];
    const checks = [
      () => {
        executed.push("warn");
        return { name: "Warn", didPass: false, isWarning: true, message: "Minor warning" };
      },
      () => {
        executed.push("skip");
        return { name: "Skip", didPass: true, isSkipped: true, message: "Skipped" };
      },
      () => {
        executed.push("pass");
        return { name: "Pass", didPass: true, message: "Passed" };
      },
    ];

    const results = await runChecks(checks);

    expect(executed).toEqual(["warn", "skip", "pass"]);
    expect(results).toHaveLength(3);
  });

  it("runs every check when all is true, even after earlier failures", async () => {
    const executed: string[] = [];
    const checks = [
      () => {
        executed.push("ports");
        return { name: "Host Ports", didPass: false, message: "Port 80 busy" };
      },
      () => {
        executed.push("env");
        return { name: "Environment Variables", didPass: false, message: ".env missing" };
      },
      () => {
        executed.push("configs");
        return { name: "Master Configs", didPass: true, message: "Configs ready" };
      },
    ];

    const results = await runChecks(checks, { all: true });

    expect(executed).toEqual(["ports", "env", "configs"]);
    expect(results.map((r) => r.name)).toEqual([
      "Host Ports",
      "Environment Variables",
      "Master Configs",
    ]);
  });

  it("skips container-dependent checks under --all when Container Runtime failed", async () => {
    let dependentCalled = false;
    let rawContainerCalled = false;
    let rawComposeCalled = false;

    const rawContainerImpl = vi.fn(() => {
      rawContainerCalled = true;
      return { name: "Container Resource Health", didPass: true, message: "OK" };
    });
    const wrappedContainerCheck = requiresContainerRuntime(
      "Container Resource Health",
      rawContainerImpl,
    );

    const rawComposeCheck = Object.assign(
      function checkDockerCompose() {
        rawComposeCalled = true;
        return { name: "Docker Compose", didPass: true, message: "OK" };
      },
      {
        requiresContainerRuntime: true,
        checkName: "Docker Compose",
      },
    );

    const checks = [
      () => ({
        name: CONTAINER_RUNTIME_CHECK,
        didPass: false,
        message: "Docker is not running",
      }),
      requiresContainerRuntime("Crash-looping containers", () => {
        dependentCalled = true;
        return { name: "Crash-looping containers", didPass: true, message: "Healthy" };
      }),
      wrappedContainerCheck,
      rawComposeCheck,
      () => ({
        name: "Environment Variables",
        didPass: false,
        message: "Missing .env",
      }),
    ];

    const results = await runChecks(checks, { all: true });

    expect(dependentCalled).toBe(false);
    expect(rawContainerCalled).toBe(false);
    expect(rawContainerImpl).not.toHaveBeenCalled();
    expect(rawComposeCalled).toBe(false);
    expect(results).toHaveLength(5);
    expect(results[1]).toMatchObject({
      name: "Crash-looping containers",
      didPass: true,
      isSkipped: true,
    });
    expect(results[2]).toMatchObject({
      name: "Container Resource Health",
      didPass: true,
      isSkipped: true,
    });
    expect(results[3]).toMatchObject({
      name: "Docker Compose",
      didPass: true,
      isSkipped: true,
    });
    expect(results[4]).toMatchObject({
      name: "Environment Variables",
      didPass: false,
    });
  });

  it("formats the one-line summary with passed, warned, failed, and skipped counts", () => {
    const summary = formatDoctorSummary([
      { name: "Docker", didPass: true, message: "OK" },
      { name: "WSL", didPass: false, isWarning: true, message: "Warning" },
      { name: "Env", didPass: false, message: "Missing .env" },
      { name: "Bun", didPass: true, isSkipped: true, message: "Skipped" },
      { name: "Smoke", didPass: true, isSkipped: true, message: "Skipped" },
    ]);

    expect(summary).toBe("1 passed, 1 warned, 1 failed, 2 skipped");
  });

  it("formats summary correctly for a warning-only run", () => {
    const summary = formatDoctorSummary([
      { name: "WSL", didPass: false, isWarning: true, message: "Warning" },
    ]);

    expect(summary).toBe("0 passed, 1 warned, 0 failed, 0 skipped");
  });

  it("treats unexpected check failures as failed in the summary instead of skipped", () => {
    const summary = formatDoctorSummary([
      { name: "Docker", didPass: true, message: "OK" },
      {
        name: "CrashCheck",
        didPass: false,
        isSkipped: false,
        message: "Check failed with an internal error",
      },
      { name: "SkippedCheck", didPass: true, isSkipped: true, message: "Skipped" },
    ]);

    expect(summary).toBe("1 passed, 1 failed, 1 skipped");
  });

  it("registers --all on doctorCommand and prints Machine, Project, and summary", async () => {
    expect(doctorCommand.options.some((opt) => opt.long === "--all")).toBe(true);

    await withDoctorCliRun("flisk-doctor-all-", "doctor-all-test", async ({ log, exit }) => {
      try {
        await doctorCommand.parseAsync(["--all", "--no-ping"], { from: "user" });
      } catch {
        // Expected when process.exit is called on failing checks
      }

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes("Machine"))).toBe(true);
      expect(lines.some((line) => line.includes("Project"))).toBe(true);
      expect(
        lines.some((line) => /^\d+ passed(?:, \d+ warned)?, \d+ failed, \d+ skipped$/.test(line)),
      ).toBe(true);
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it("prints Project section when running --all outside a project even with failing checks", async () => {
    await withDoctorCliRun("flisk-doctor-no-project-", undefined, async ({ log }) => {
      try {
        await doctorCommand.parseAsync(["--all", "--no-ping"], { from: "user" });
      } catch {
        // Expected when process.exit is called
      }

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes("Machine"))).toBe(true);
      expect(lines.some((line) => line.includes("Project"))).toBe(true);
      expect(
        lines.some((line) =>
          line.includes("Not in a Flisk project, so project checks were skipped"),
        ),
      ).toBe(true);
      expect(
        lines.some((line) => /^\d+ passed(?:, \d+ warned)?, \d+ failed, \d+ skipped$/.test(line)),
      ).toBe(true);
    });
  });

  it("preserves machine-readable JSON envelope when --all and --json are combined", async () => {
    await withDoctorCliRun("flisk-doctor-json-all-", "doctor-json-all", async ({ log, exit }) => {
      try {
        await doctorCommand.parseAsync(["--all", "--json", "--no-ping"], { from: "user" });
      } catch {
        // Expected when process.exit is called on failing checks
      }

      const jsonCall = log.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(String(call[0]));
          return (
            parsed &&
            typeof parsed.schemaVersion === "number" &&
            parsed.data &&
            Array.isArray(parsed.data.checks)
          );
        } catch {
          return false;
        }
      });

      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall?.[0]));
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.data.checks.length).toBeGreaterThan(0);
      expect(typeof parsed.data.ready).toBe("boolean");
      expect(typeof parsed.data.inProject).toBe("boolean");
      expect(Array.isArray(parsed.errors)).toBe(true);

      const nonJsonCalls = log.mock.calls
        .map((call) => String(call[0]))
        .filter((str) => !str.startsWith("{"));
      expect(nonJsonCalls.some((str) => str.includes("Machine"))).toBe(false);
      expect(nonJsonCalls.some((str) => str.includes("Project"))).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  it("renders Project heading under --all when in a project even if project checks are empty", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const machineResults: CheckResult[] = [{ name: "Host Ports", didPass: true, message: "OK" }];
      const projectResults: CheckResult[] = [];

      renderDoctorOutput(machineResults, projectResults, true, { all: true });

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes("Machine"))).toBe(true);
      expect(lines.some((line) => line.includes("Project"))).toBe(true);
      expect(lines.some((line) => line.includes("Not in a Flisk project"))).toBe(false);
      expect(lines.some((line) => line.includes("1 passed, 0 failed, 0 skipped"))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("renders Project heading and skipped message under --all when not in a project", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const machineResults: CheckResult[] = [
        { name: "Host Ports", didPass: false, message: "Port busy" },
      ];
      const projectResults: CheckResult[] = [];

      renderDoctorOutput(machineResults, projectResults, false, { all: true });

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes("Machine"))).toBe(true);
      expect(lines.some((line) => line.includes("Project"))).toBe(true);
      expect(
        lines.some((line) =>
          line.includes("Not in a Flisk project, so project checks were skipped"),
        ),
      ).toBe(true);
      expect(lines.some((line) => line.includes("0 passed, 1 failed, 0 skipped"))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("does not print Machine or Project headings or summary without --all", async () => {
    await withDoctorCliRun("flisk-doctor-plain-", "doctor-plain-test", async ({ log }) => {
      try {
        await doctorCommand.parseAsync(["--no-ping"], { from: "user" });
      } catch {
        // Expected when process.exit is called on failing checks
      }

      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line === "Machine")).toBe(false);
      expect(lines.some((line) => line === "\nProject" || line === "Project")).toBe(false);
      expect(lines.some((line) => /^\d+ passed, \d+ failed, \d+ skipped$/.test(line))).toBe(false);
      expect(checkWindowsRuntimeTools).not.toHaveBeenCalled();
      expect(checkWindowsDockerMode).not.toHaveBeenCalled();
      expect(checkWindowsHostConfiguration).not.toHaveBeenCalled();
    });
  });
});
