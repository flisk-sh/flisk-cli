// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  checkHostPorts,
  DOCTOR_FIXES,
  describe,
  expect,
  getDoctorOutcomeMessage,
  HOST_PORT_FIXES,
  it,
  noOwner,
  WSL2_DOCTOR_MESSAGE,
} from "./test-support.js";

describe("doctor exact guidance", () => {
  it("keeps prerequisite fixes as the specified copy-paste text", () => {
    expect(DOCTOR_FIXES).toEqual({
      dockerMissing: "See https://docs.docker.com/get-docker/",
      dockerDaemonDown: "Start Docker Desktop, OrbStack, Colima, or Kiri, then retry: flisk doctor",
      tiltMissing:
        "curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash",
      bunMissing: "curl -fsSL https://bun.sh/install | bash",
      port80: "Stop the process bound to port 80, or stop local nginx/caddy. Then: flisk doctor",
      port5432: "Stop local Postgres or change the host port. Then: flisk doctor",
      notProject: "flisk project --yes",
    });
    expect(WSL2_DOCTOR_MESSAGE).toBe(
      "WSL2 detected. Use Docker Desktop WSL integration. Guide: docs/wsl2.md",
    );
  });

  it("prints exact project-aware final outcomes", () => {
    expect(getDoctorOutcomeMessage(false, true)).toBe("Doctor passed. Next: flisk project example");
    expect(getDoctorOutcomeMessage(true, true)).toBe("Doctor passed. Next: flisk up");
    expect(getDoctorOutcomeMessage(true, false)).toBe(
      "Doctor failed. Fix the items above, then run: flisk doctor",
    );
  });

  it("uses exact remediation copy for ports 80 and 5432", async () => {
    const port80 = await checkHostPorts(
      (() => "") as never,
      "flisk-project",
      async (port) => (port === 80 ? "in-use" : "free"),
      undefined,
      noOwner,
    );
    const port5432 = await checkHostPorts(
      (() => "") as never,
      "flisk-project",
      async (port) => (port === 5432 ? "in-use" : "free"),
      undefined,
      noOwner,
    );

    expect(port80.fix).toBe(HOST_PORT_FIXES.port80);
    expect(port5432.fix).toBe(HOST_PORT_FIXES.port5432);
  });

  it("identifies process owner when available and updates fix message and observed data", async () => {
    const mockFindOwner = (port: number) =>
      port === 5432
        ? {
            ownerType: "process" as const,
            type: "process" as const,
            kind: "process" as const,
            port: 5432,
            process: "postgres",
            name: "postgres",
            pid: 1234,
            setting: "FLISK_POSTGRES_PORT",
          }
        : null;

    const result = await checkHostPorts(
      (() => "") as never,
      "flisk-project",
      async (port) => (port === 5432 ? "in-use" : "free"),
      undefined,
      mockFindOwner,
    );

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("5432 (Postgres) is used by process postgres (pid 1234)");
    expect(result.fix).not.toContain("FLISK_POSTGRES_PORT");
    expect(result.fix).toContain("PID 1234");
    expect(result.observed).toMatchObject({
      ownerType: "process",
      process: "postgres",
      pid: 1234,
      port: 5432,
    });
  });
});
