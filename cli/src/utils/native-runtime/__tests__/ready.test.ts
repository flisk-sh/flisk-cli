// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { createTempDir } from "../../../test-support/index.js";
import type { NativeServicePlan } from "../plan.js";
import {
  isChildRunning,
  isPortListening,
  isProcessAlive,
  missingProgramNote,
  missingProgramReason,
  notReadyReason,
  probeServiceReady,
  sleep,
  startFailureReason,
  waitForServiceReady,
} from "../ready.js";

/** A port the OS just handed out, so parallel test workers never collide on a guessed one. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const basePlan = (over: Partial<NativeServicePlan> = {}): NativeServicePlan => ({
  name: "api",
  command: "node s.js",
  cwd: "/tmp/api",
  env: {},
  dependsOn: [],
  restart: true,
  ...over,
});

describe("ready cluster interface", () => {
  it("exports the readiness surface", () => {
    for (const fn of [
      isChildRunning,
      isPortListening,
      isProcessAlive,
      missingProgramNote,
      missingProgramReason,
      notReadyReason,
      probeServiceReady,
      sleep,
      startFailureReason,
      waitForServiceReady,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("isProcessAlive and isChildRunning", () => {
  it("reports a live process and a dead pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(4_000_000_000)).toBe(false);
  });

  it("tells a running child from an exited one", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
    expect(isChildRunning(child)).toBe(true);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    expect(isChildRunning(child)).toBe(false);
    expect(isChildRunning(undefined)).toBe(false);
  });
});

describe("isPortListening", () => {
  it("is true while something accepts connections and false once it stops", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    expect(await isPortListening(port)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortListening(port)).toBe(false);
  });
});

describe("probeServiceReady", () => {
  it("probes the port the plan serves", async () => {
    const port = await freePort();
    expect(await probeServiceReady(basePlan({ port }))).toBeNull();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, resolve));
    try {
      expect(await probeServiceReady(basePlan({ port }))).toBe(0);
    } finally {
      server.close();
    }
  });

  it("drops the explicit probe when health checks are disabled, but still falls back to the port", async () => {
    const port = await freePort();
    const failingCommand = {
      kind: "command" as const,
      command: [process.execPath, "-e", "process.exit(1)"],
    };
    expect(await probeServiceReady(basePlan({ port, readiness: failingCommand }))).toBeNull();
    expect(
      await probeServiceReady(
        basePlan({ port, readiness: failingCommand, healthCheckDisabled: true }),
      ),
    ).toBeNull();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(port, resolve));
    try {
      expect(
        await probeServiceReady(
          basePlan({ port, readiness: failingCommand, healthCheckDisabled: true }),
        ),
      ).toBe(0);
    } finally {
      server.close();
    }
  });

  it("answers a health URL with its status, null when nothing answers", async () => {
    const port = await freePort();
    expect(await probeServiceReady(basePlan({ healthUrl: `http://localhost:${port}` }))).toBeNull();
  });

  it("runs a healthCheck.command from the service folder", async () => {
    const cwd = createTempDir();
    expect(
      await probeServiceReady(
        basePlan({
          cwd,
          readiness: { kind: "command", command: [process.execPath, "-e", "process.exit(0)"] },
        }),
      ),
    ).toBe(0);
    expect(
      await probeServiceReady(
        basePlan({
          cwd,
          readiness: { kind: "command", command: [process.execPath, "-e", "process.exit(1)"] },
        }),
      ),
    ).toBeNull();
  });
});

describe("waitForServiceReady", () => {
  it("is ready once the port listens", async () => {
    const port = await freePort();
    const plan = basePlan({ port });
    const server = createServer();
    setTimeout(() => server.listen(port), 300);
    try {
      expect(await waitForServiceReady(plan, { isAlive: () => true, intervalMs: 50 })).toBe(true);
    } finally {
      server.close();
    }
  });

  it("is not ready when the process dies first or the timeout passes", async () => {
    const port = await freePort();
    const plan = basePlan({ port });
    expect(
      await waitForServiceReady(plan, { isAlive: () => false, timeoutMs: 5_000, intervalMs: 50 }),
    ).toBe(false);
    expect(
      await waitForServiceReady(plan, { isAlive: () => true, timeoutMs: 300, intervalMs: 50 }),
    ).toBe(false);
  });

  it("gives a service without a readiness signal a grace second, then reports alive", async () => {
    const started = Date.now();
    const plan = basePlan({ healthCheckDisabled: true });
    expect(await waitForServiceReady(plan, { isAlive: () => true })).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});

describe("reason helpers", () => {
  it("names what a service that never became ready was waiting for", () => {
    expect(notReadyReason(basePlan({ port: 4100 }))).toBe("nothing listening on port 4100");
    expect(notReadyReason(basePlan({ healthUrl: "http://localhost:4100/h" }))).toBe(
      "no answer from http://localhost:4100/h",
    );
    expect(
      notReadyReason(
        basePlan({ readiness: { kind: "command", command: ["pg_isready", "-h", "db"] } }),
      ),
    ).toBe("healthCheck.command never exited 0: pg_isready -h db");
  });

  it("names the missing program for exit 127 and the clause for an exit note", () => {
    const plan = basePlan({ command: "nope-xyz serve" });
    expect(missingProgramReason(plan, 127)).toBe("runs nope-xyz, which is not installed");
    expect(missingProgramReason(plan, 1)).toBe("kept exiting; see its output above");
    expect(missingProgramNote(plan)).toBe(": api runs nope-xyz, which is not installed");
    // A command whose first word is an expansion names no single program, so the clause stays empty.
    expect(missingProgramNote(basePlan({ command: "$SERVICE_CMD serve" }))).toBe("");
  });

  it("builds the first-start failure reason", () => {
    expect(startFailureReason(basePlan({ job: true }), false, null)).toBe(
      "the job did not exit 0; see its output above",
    );
    expect(startFailureReason(basePlan({ command: "nope-xyz" }), true, 127)).toBe(
      "runs nope-xyz, which is not installed",
    );
    expect(startFailureReason(basePlan({ port: 4100 }), false, null, 3_000)).toBe(
      "not ready after 3s (nothing listening on port 4100)",
    );
  });
});
