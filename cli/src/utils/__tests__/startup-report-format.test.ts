// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { machineProblemFix, withLoggedReasons } from "../startup-fixes.js";
import {
  formatFailureDetail,
  formatStartupReport,
  formatWaitFailures,
} from "../startup-report-format.js";

describe("formatStartupReport", () => {
  it("prints the failed service, what it blocks and the way out", () => {
    const lines = formatStartupReport(
      {
        failed: [{ name: "postgres", message: "host port 5432 is already allocated" }],
        blocked: [{ name: "api", because: ["postgres"] }],
        starting: [],
      },
      false,
    );
    expect(lines).toEqual([
      "✗ postgres failed: host port 5432 is already allocated",
      "  Fix: stop the process using port 5432 (find it with: lsof -nP -iTCP:5432 -sTCP:LISTEN), or set FLISK_POSTGRES_PORT to a free port and run flisk up",
      "✗ api is not ready because postgres failed",
      "The environment is not ready: postgres failed, so 1 dependent service is not ready. Tilt is still running; inspect it or run: flisk down",
    ]);
  });

  it("names the process holding the port when it is known", () => {
    const lines = formatStartupReport(
      {
        failed: [{ name: "postgres", message: "host port 5432 is already allocated" }],
        blocked: [],
        starting: [],
      },
      false,
      () => ({ pid: 4321, command: "postgres" }),
    );
    expect(lines[1]).toBe(
      "  Fix: port 5432 is held by postgres (pid 4321). Stop it, or set FLISK_POSTGRES_PORT to a free port and run flisk up",
    );
  });

  it("looks up the occupant only for port conflicts", () => {
    const occupantOf = vi.fn(() => null);
    formatStartupReport(
      { failed: [{ name: "worker", message: "exited with 1" }], blocked: [], starting: [] },
      false,
      occupantOf,
    );
    expect(occupantOf).not.toHaveBeenCalled();
  });

  it("prefers the port-conflict fix, then the machine-problem fix, then the message's own", () => {
    const machineFixes = new Map([
      ["db", "Fix: machine fix from the map"],
      ["db2", "Fix: machine fix for db2"],
    ]);
    const lines = formatStartupReport(
      {
        failed: [
          { name: "db", message: "host port 5432 is already allocated" },
          {
            name: "db2",
            message: "all predefined address pools have been fully subnetted",
          },
        ],
        blocked: [],
        starting: [],
      },
      false,
      () => null,
      machineFixes,
    );
    expect(lines[1]).toContain("port 5432");
    expect(lines[3]).toBe("  Fix: machine fix for db2");
  });

  it("ends with how many dependent services each failure leaves not ready", () => {
    const lines = formatStartupReport(
      {
        failed: [
          { name: "postgres", message: "container is running, but its health check is failing" },
        ],
        blocked: [
          { name: "api", because: ["postgres"] },
          { name: "migrator", because: ["postgres"] },
          { name: "worker", because: ["postgres"] },
        ],
        starting: [],
      },
      false,
    );
    expect(lines.at(-1)).toBe(
      "The environment is not ready: postgres failed, so 3 dependent services are not ready. Tilt is still running; inspect it or run: flisk down",
    );
  });

  it("keeps the plain closing line when a failure blocks nothing", () => {
    const lines = formatStartupReport(
      { failed: [{ name: "worker", message: "exited with 1" }], blocked: [], starting: [] },
      false,
    );
    expect(lines.at(-1)).toBe(
      "The environment is not ready. Tilt is still running; inspect it or run: flisk down",
    );
  });

  it("says timed out for services that never finished", () => {
    const lines = formatStartupReport({ failed: [], blocked: [], starting: ["api", "web"] }, true);
    expect(lines[0]).toBe("Timed out waiting for api, web");
  });

  it("says timed out while building when stillBuilding is present", () => {
    const lines = formatStartupReport(
      { failed: [], blocked: [], starting: [], stillBuilding: ["api"] },
      true,
    );
    expect(lines[0]).toBe("Timed out while building: api");
  });

  it("says still building and still starting without a timeout", () => {
    const lines = formatStartupReport(
      { failed: [], blocked: [], starting: ["web"], stillBuilding: ["api-image"] },
      false,
    );
    expect(lines).toContain("Still building: api-image");
    expect(lines).toContain("Still starting: web");
  });

  it("prints the last log lines for a service that timed out", () => {
    const lines = formatStartupReport(
      {
        failed: [],
        blocked: [],
        starting: ["postgres"],
        lastLogs: {
          postgres:
            "Starting database...\nError: FATAL password authentication failed for user 'flisk'",
        },
      },
      true,
    );
    expect(lines).toContain("Timed out waiting for postgres");
    expect(lines).toContain("Last log lines for postgres:");
    expect(lines).toContain("  Error: FATAL password authentication failed for user 'flisk'");
  });

  it("keeps only the last ten log lines per timed-out service", () => {
    const logs = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const lines = formatStartupReport(
      { failed: [], blocked: [], starting: ["api"], lastLogs: { api: logs } },
      true,
    );
    expect(lines).toContain("  line 15");
    expect(lines).not.toContain("  line 5");
  });

  it("prefers the caller's lastLogs over the report's for the same service", () => {
    const lines = formatStartupReport(
      {
        failed: [],
        blocked: [],
        starting: ["api"],
        lastLogs: { api: "from the report" },
      },
      true,
      undefined,
      new Map(),
      { api: "from the caller" },
    );
    expect(lines).toContain("  from the caller");
    expect(lines).not.toContain("  from the report");
  });

  it("prints nothing when nothing is wrong", () => {
    expect(formatStartupReport({ failed: [], blocked: [], starting: [] }, false)).toEqual([]);
  });

  it("prints the failing health probe's command and last output under the failure (#3056)", () => {
    const lines = formatStartupReport(
      {
        failed: [
          {
            name: "facial-recognition",
            message: "container is running, but its health check is failing",
            probe: {
              command: ["curl", "-f", "http://localhost:8000/health"],
              output: 'exec: "curl": executable file not found',
              exitCode: -1,
            },
          },
        ],
        blocked: [],
        starting: [],
      },
      false,
    );
    expect(lines[0]).toBe(
      "✗ facial-recognition failed: container is running, but its health check is failing",
    );
    expect(lines[1]).toBe(
      '  probe: [curl -f http://localhost:8000/health] -> exec: "curl": executable file not found',
    );
  });

  it("reports the exit code when a failing probe printed nothing", () => {
    const lines = formatStartupReport(
      {
        failed: [
          {
            name: "db",
            message: "container is running, but its health check is failing",
            probe: { command: ["pg_isready"], output: "", exitCode: 2 },
          },
        ],
        blocked: [],
        starting: [],
      },
      false,
    );
    expect(lines[1]).toBe("  probe: [pg_isready] -> exit 2");
  });
});

describe("formatFailureDetail", () => {
  it("returns an empty string for no failures", () => {
    expect(formatFailureDetail([])).toBe("");
  });

  it("prints a single failure's name and message", () => {
    expect(formatFailureDetail([{ name: "web", message: "exited with 1" }])).toBe(
      "web:\nexited with 1",
    );
  });

  it("groups failures that printed the same reason and counts them", () => {
    const detail = formatFailureDetail([
      { name: "a", message: "same reason" },
      { name: "b", message: "same reason" },
      { name: "c", message: "other reason" },
    ]);
    expect(detail).toBe("2 resources failed the same way (a, b):\nsame reason\nc:\nother reason");
  });

  it("appends the fix, without its Fix: prefix, to the grouped label", () => {
    const detail = formatFailureDetail([
      { name: "init-networks", message: "pool exhausted", fix: "Fix: run docker network prune" },
    ]);
    expect(detail).toBe("init-networks: run docker network prune\npool exhausted");
  });

  it("prints a health-check failure's probe under its message (#3056)", () => {
    const detail = formatFailureDetail([
      {
        name: "api",
        message: "container is running, but its health check is failing",
        probe: {
          command: ["curl", "-f", "http://localhost:4000/health"],
          output: "curl: (7) Failed to connect",
          exitCode: 7,
        },
      },
    ]);
    expect(detail).toBe(
      "api:\ncontainer is running, but its health check is failing\n    probe: [curl -f http://localhost:4000/health] -> curl: (7) Failed to connect",
    );
  });

  it("names each probe when several services failed their health checks the same way", () => {
    const detail = formatFailureDetail([
      {
        name: "api",
        message: "container is running, but its health check is failing",
        probe: { command: ["curl", "-f", "a"], output: "refused" },
      },
      {
        name: "worker",
        message: "container is running, but its health check is failing",
        probe: { command: ["wget", "b"], output: "timed out" },
      },
    ]);
    expect(detail).toBe(
      "2 resources failed the same way (api, worker):\ncontainer is running, but its health check is failing\n    api probe: [curl -f a] -> refused\n    worker probe: [wget b] -> timed out",
    );
  });
});

describe("formatWaitFailures", () => {
  it("prints each failure's reason and, under it, the fix", () => {
    const lines = formatWaitFailures([
      {
        name: "init-networks",
        message:
          "Error response from daemon: all predefined address pools have been fully subnetted",
        fix:
          machineProblemFix("all predefined address pools have been fully subnetted") ?? undefined,
      },
      { name: "cache", reason: "pull access denied" },
    ]);
    expect(lines[0]).toMatch(
      /^init-networks: Error response from daemon: all predefined address pools have been fully subnetted\n {4}→ Docker has no free network ranges left/,
    );
    expect(lines[1]).toBe("cache: pull access denied");
  });

  it("prefers a failure's reason field over its message", () => {
    expect(
      formatWaitFailures([{ name: "web", reason: "the reason", message: "the message" }]),
    ).toEqual(["web: the reason"]);
  });

  it("says failed when a failure has no text", () => {
    expect(formatWaitFailures([{ name: "web" }])).toEqual(["web: failed"]);
  });

  it("counts several log lines in the plural", () => {
    expect(
      formatWaitFailures([{ name: "web", message: "down", logs: ["one", "two"] }])[0],
    ).toContain("(last 2 lines of: flisk logs --service web)");
  });

  // #3056: a health-check failure names its probe's command and last output, before the log lines.
  it("prints a health-check failure's probe between its fix and its log lines", () => {
    expect(
      formatWaitFailures([
        {
          name: "api",
          message: "container is running, but its health check is failing",
          probe: {
            command: ["curl", "-f", "http://localhost:8000/health"],
            output: 'exec: "curl": executable file not found',
          },
          logs: ["GET /health - refused"],
        },
      ]),
    ).toEqual([
      'api: container is running, but its health check is failing\n    probe: [curl -f http://localhost:8000/health] -> exec: "curl": executable file not found\n    GET /health - refused\n    (last line of: flisk logs --service api)',
    ]);
  });

  // #3823: an unhealthy service's log lines go under its own failure, not as a second entry for it.
  it("prints a failure's log lines under it and how to see more", () => {
    expect(
      formatWaitFailures([
        { name: "py", message: "health check is failing", logs: ["boom: cannot connect"] },
        { name: "web", message: "not healthy", logs: [] },
      ]),
    ).toEqual([
      "py: health check is failing\n    boom: cannot connect\n    (last line of: flisk logs --service py)",
      "web: not healthy",
    ]);
  });
});

describe("report lines from explained failures", () => {
  it("puts a logged reason into the failure line of the report", async () => {
    const logs: Record<string, string> = {
      "postgres-healthy":
        "ERROR: postgres is unhealthy: its health check still failed 120s after it first failed\n",
    };
    const failed = await withLoggedReasons(
      [{ name: "postgres-healthy", message: "exit status 1" }],
      async (name) => logs[name] ?? null,
    );
    expect(formatStartupReport({ failed, blocked: [], starting: [] }, false)[0]).toBe(
      "✗ postgres-healthy failed: postgres is unhealthy: its health check still failed 120s after it first failed",
    );
  });
});
