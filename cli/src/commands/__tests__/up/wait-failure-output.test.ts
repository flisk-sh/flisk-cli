// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  captureStdoutWriteSync,
  describe,
  expect,
  it,
  runCommandInProcess,
  stripVTControlCharacters,
  upAndWait,
  upCommand,
  upWaitServiceHealth,
  vi,
} from "../../test-support/up.js";

describe("flisk up --wait JSON output", () => {
  it.each([
    ["ready", { schemaVersion: 1, data: { ok: true, runtime: "native" }, errors: [] }, 0],
    [
      "failed",
      {
        schemaVersion: 1,
        data: { ok: false, failures: [{ name: "api", reason: "container exited" }] },
        errors: [{ code: "UP_RESOURCE_FAILED", message: "Resources failed", suggestions: [] }],
      },
      1,
    ],
  ] as const)(
    "emits one %s result and suppresses the exit fallback",
    async (kind, envelope, exitCode) => {
      const stdout = captureStdoutWriteSync();
      vi.mocked(upAndWait).mockResolvedValueOnce({ kind, json: JSON.stringify(envelope) });
      const listenersBefore = new Set(process.listeners("exit"));
      try {
        const result = await runCommandInProcess(upCommand, ["--wait", "--json"], process.cwd());
        expect(result.status).toBe(exitCode);
        expect(result.stdout).toBe("");
        const documents = stdout.text().trim().split("\n");
        expect(documents).toHaveLength(1);
        // A failed run also reports each service's health (empty here: the health lookup is mocked) (#3102).
        const expected =
          kind === "failed"
            ? { ...envelope, data: { ...envelope.data, services: [], unhealthy: [] } }
            : envelope;
        expect(JSON.parse(documents[0] as string)).toEqual(expected);
        const exitHandlers = process
          .listeners("exit")
          .filter((listener) => !listenersBefore.has(listener));
        expect(exitHandlers).toHaveLength(1);
        for (const exitHandler of exitHandlers) {
          (exitHandler as NodeJS.ExitListener)(exitCode);
        }
        expect(stdout.text().trim().split("\n")).toHaveLength(1);
      } finally {
        for (const listener of process.listeners("exit")) {
          if (!listenersBefore.has(listener)) process.removeListener("exit", listener);
        }
        vi.mocked(upAndWait).mockReset();
        stdout.restore();
        upCommand.setOptionValue("wait", false);
        upCommand.setOptionValue("json", false);
      }
    },
  );
});

describe("flisk up --wait failure output", () => {
  it("prints failure reasons instead of undefined", async () => {
    vi.mocked(upAndWait).mockResolvedValueOnce({
      kind: "failed",
      json: JSON.stringify({
        schemaVersion: 1,
        data: {
          ok: false,
          failures: [
            { name: "lp1-api", reason: "kept exiting" },
            { name: "lp1-web", reason: "not started: lp1-api did not start" },
            { name: "lp1-db", message: "Docker could not start" },
            { name: "lp1-worker" },
          ],
        },
        errors: [],
      }),
    });
    upCommand.setOptionValue("json", false);

    try {
      const result = await runCommandInProcess(upCommand, ["--wait"], process.cwd());
      const output = stripVTControlCharacters(result.stderr);
      expect(result.status).toBe(1);
      expect(output).toContain("lp1-api: kept exiting");
      expect(output).toContain("lp1-web: not started: lp1-api did not start");
      expect(output).toContain("lp1-db: Docker could not start");
      expect(output).toContain("lp1-worker: failed");
      expect(output).not.toContain("undefined");
    } finally {
      vi.mocked(upAndWait).mockReset();
      upCommand.setOptionValue("wait", false);
      upCommand.setOptionValue("json", false);
    }
  });
});

// #3102: `flisk up --wait --json` reports each service's health and a short reason, so a CI job or a coding
// agent sees what is unhealthy without parsing the text output.
describe("flisk up --wait --json service health", () => {
  const failedResult = JSON.stringify({
    schemaVersion: 1,
    data: {
      ok: false,
      failures: [{ name: "db", reason: "kept exiting; see its output above" }],
    },
    errors: [{ code: "UP_RESOURCE_FAILED", message: "Resources failed" }],
  });

  function restoreWait(): void {
    vi.mocked(upAndWait).mockReset();
    vi.mocked(upWaitServiceHealth).mockReset();
    upCommand.setOptionValue("wait", false);
    upCommand.setOptionValue("json", false);
  }

  it("adds every service's status and reason, and the unhealthy names, to a failed result", async () => {
    vi.mocked(upAndWait).mockResolvedValueOnce({ kind: "failed", json: failedResult });
    vi.mocked(upWaitServiceHealth).mockResolvedValueOnce([
      { name: "web", status: "healthy" },
      { name: "db", status: "exited", reason: "exited with code 1" },
    ]);
    const stdout = captureStdoutWriteSync();
    try {
      const result = await runCommandInProcess(upCommand, ["--wait", "--json"], process.cwd());
      expect(result.status).toBe(1);
      const envelope = JSON.parse(stdout.text().trim()) as {
        data: {
          ok: boolean;
          services: Array<{ name: string; status: string; reason?: string }>;
          unhealthy: string[];
          failures: Array<{ name: string }>;
        };
        errors: Array<{ code: string }>;
      };
      expect(envelope.data.ok).toBe(false);
      expect(envelope.data.services).toEqual([
        { name: "web", status: "healthy" },
        { name: "db", status: "exited", reason: "exited with code 1" },
      ]);
      expect(envelope.data.unhealthy).toEqual(["db"]);
      expect(envelope.data.failures[0]?.name).toBe("db");
    } finally {
      stdout.restore();
      restoreWait();
    }
  });

  it("lists the services and unhealthy names on a timeout envelope", async () => {
    vi.mocked(upAndWait).mockResolvedValueOnce({
      kind: "timeout",
      logTail: "still building\n",
      logFile: "/tmp/up.log",
    });
    vi.mocked(upWaitServiceHealth).mockResolvedValueOnce([
      { name: "web", status: "healthy" },
      { name: "api", status: "unhealthy", reason: "starting" },
    ]);
    const stdout = captureStdoutWriteSync();
    try {
      const result = await runCommandInProcess(upCommand, ["--wait", "--json"], process.cwd());
      expect(result.status).toBe(1);
      const envelope = JSON.parse(stdout.text().trim()) as {
        data: {
          ok: boolean;
          services: Array<{ name: string; status: string; reason?: string }>;
          unhealthy: string[];
        };
        errors: Array<{ code: string }>;
      };
      expect(envelope.data.ok).toBe(false);
      expect(envelope.data.services).toEqual([
        { name: "web", status: "healthy" },
        { name: "api", status: "unhealthy", reason: "starting" },
      ]);
      expect(envelope.data.unhealthy).toEqual(["api"]);
      expect(envelope.errors[0]?.code).toBe("UP_WAIT_TIMEOUT");
    } finally {
      stdout.restore();
      restoreWait();
    }
  });

  it("asks the health report for the --only selection's services", async () => {
    vi.mocked(upAndWait).mockResolvedValueOnce({ kind: "failed", json: failedResult });
    try {
      const result = await runCommandInProcess(
        upCommand,
        ["--wait", "--json", "--only", "web"],
        process.cwd(),
      );
      expect(result.status).toBe(1);
      expect(vi.mocked(upWaitServiceHealth)).toHaveBeenCalledWith(
        expect.objectContaining({ only: ["web"] }),
      );
    } finally {
      restoreWait();
    }
  });
});
