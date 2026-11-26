// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// In-process cases for `flisk logs`: a project of `command` services reads its own log files (no Tilt), a text-mode
// usage error, and the Tilt reads that fail or cannot be parsed. Discovery, the native runtime and Tilt are doubles,
// so each case states the services, states and lines it sees.

import { tmpdir } from "node:os";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeResource, parseEnvelope, runCommandInProcess } from "../../test-support/index.js";
import type { DiscoveredResource, DiscoveryProblem } from "../../types/index.js";
import type { NativeLogLine, NativeRunState } from "../../utils/native-runtime.js";

const paths = vi.hoisted(() => ({ findProjectRoot: vi.fn<() => string | null>() }));
const tilt = vi.hoisted(() => ({
  isTiltAvailable: vi.fn(async () => true),
  runTilt: vi.fn(),
}));
const services = vi.hoisted(() => ({
  discoverResourcesFromRoot: vi.fn<(root: string) => DiscoveredResource[]>(),
  discoverResourcesWithProblems:
    vi.fn<(root: string) => { resources: DiscoveredResource[]; problems: DiscoveryProblem[] }>(),
}));
const nativeService = vi.hoisted(() => ({
  isNativeProject: vi.fn((_resources: readonly DiscoveredResource[]): boolean => false),
}));
const nativeRuntime = vi.hoisted(() => ({
  isNativeRunSupervisorAlive: vi.fn(async () => false),
  nativeServiceStates: vi.fn(),
  readNativeLogLines: vi.fn((): NativeLogLine[] => []),
  readNativeRunState: vi.fn((): NativeRunState | null => null),
  recordedNativeServiceNames: vi.fn((): string[] => []),
}));
const orchestration = vi.hoisted(() => ({
  isTiltfileOrchestration: vi.fn<(projectRoot: string) => boolean>(() => false),
}));
const secrets = vi.hoisted(() => ({ envSecretValues: vi.fn((): string[] => []) }));

vi.mock("../../utils/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/paths.js")>()),
  ...paths,
}));
vi.mock("../../utils/tilt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/tilt.js")>()),
  ...tilt,
}));
vi.mock("../../utils/services.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/services.js")>()),
  ...services,
}));
vi.mock("../../utils/native-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/native-service.js")>()),
  ...nativeService,
}));
vi.mock("../../utils/native-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/native-runtime.js")>()),
  ...nativeRuntime,
}));
vi.mock("../../utils/secret-redaction.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/secret-redaction.js")>()),
  ...secrets,
}));
vi.mock("../../generator/project-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../generator/project-config.js")>()),
  ...orchestration,
}));

import { logsCommand } from "../logs.js";

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const line = (resource: string, text: string, run: string | null = null): NativeLogLine => ({
  time: "2026-10-31T10:00:00.000Z",
  resource,
  level: null,
  source: null,
  text,
  run,
});
const numbered = (seq: number, resource: string, text: string): NativeLogLine => ({
  ...line(resource, text),
  seq,
});
const NATIVE = [
  makeResource("api", "backend", { command: "node api.js" }),
  makeResource("frontend", "frontend", { command: "vite" }),
];
const resourcesJson = (...names: string[]) =>
  ok(JSON.stringify({ items: names.map((name) => ({ metadata: { name } })) }));

/** Every discovery entry point the command calls sees the same resources and skipped manifests. */
function mockDiscovery(resources: DiscoveredResource[], problems: DiscoveryProblem[] = []): void {
  services.discoverResourcesFromRoot.mockReturnValue(resources);
  services.discoverResourcesWithProblems.mockReturnValue({ resources, problems });
}

// A recorded run where api never spawned because it waits on db2, whose health check is down.
function mockBlockedDependencyRun(): string {
  const root = "/project";
  nativeRuntime.readNativeRunState.mockReturnValue({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    services: {
      db2: { pid: process.pid, port: 4003, ready: false },
      api: { ready: false },
    },
  } as unknown as NativeRunState);
  paths.findProjectRoot.mockReturnValue(root);
  mockDiscovery([
    makeResource("api", "backend", { command: "node api.js", dependsOn: ["db2"] }),
    makeResource("db2", "backend", {
      command: "sleep 300",
      port: 4003,
      healthCheckPath: "/health",
    }),
  ]);
  nativeRuntime.nativeServiceStates.mockReturnValue({
    api: { status: "pending", reason: "waiting to start" },
    db2: { status: "pending", reason: "starting" },
  });
  nativeRuntime.readNativeLogLines.mockReturnValue([]);
  return root;
}

/**
 * Commander keeps option values on the command object between parses, so put every option back to its default first.
 * One module instance (no `vi.resetModules`) keeps v8 coverage attributed to a single copy of logs.ts.
 */
function resetOptions(command: Command): void {
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), option.defaultValue);
  }
}

async function runLogs(args: string[]) {
  resetOptions(logsCommand);
  return runCommandInProcess(logsCommand, args, tmpdir());
}

describe("flisk logs (in-process)", () => {
  it("filters native redacted logs with per-service context and keeps no-grep output unchanged", async () => {
    nativeService.isNativeProject.mockReturnValue(true);
    services.discoverResourcesFromRoot.mockReturnValue(NATIVE);
    secrets.envSecretValues.mockReturnValue(["private-token"]);
    nativeRuntime.readNativeLogLines.mockReturnValue([
      line("api", "before"),
      line("frontend", "unrelated"),
      line("api", "ERROR private-token"),
      line("api", "after"),
    ]);
    const result = await runLogs(["--json", "--grep", "error", "--context", "1"]);
    const envelope = parseEnvelope(result.stdout);
    expect(
      envelope.data.lines.map((r: { resource: string; match: boolean }) => [r.resource, r.match]),
    ).toEqual([
      ["api", false],
      ["api", true],
      ["api", false],
    ]);
    expect(result.stdout).not.toContain("private-token");
    expect(tilt.runTilt).not.toHaveBeenCalled();
    const secretOnly = await runLogs(["--json", "--grep", "private-token"]);
    expect(parseEnvelope(secretOnly.stdout).data.lines).toEqual([]);
    const noHit = await runLogs(["--grep", "absent"]);
    expect(noHit.stdout).toBe("");
    const unchanged = await runLogs(["--json"]);
    expect(parseEnvelope(unchanged.stdout).data.lines).toHaveLength(4);
    expect(unchanged.stdout).not.toContain('"match"');
  });
  beforeEach(() => {
    process.exitCode = 0;
    delete process.env.TILT_PORT;
    paths.findProjectRoot.mockReturnValue("/project");
    tilt.isTiltAvailable.mockResolvedValue(true);
    mockDiscovery([]);
    nativeService.isNativeProject.mockReturnValue(false);
    nativeRuntime.recordedNativeServiceNames.mockReturnValue([]);
    nativeRuntime.readNativeRunState.mockReturnValue(null);
    nativeRuntime.isNativeRunSupervisorAlive.mockResolvedValue(false);
    orchestration.isTiltfileOrchestration.mockReturnValue(false);
    secrets.envSecretValues.mockReturnValue([]);
  });
  afterEach(() => {
    vi.resetAllMocks();
    process.exitCode = 0;
  });

  describe("a project of command services", () => {
    beforeEach(() => {
      mockDiscovery(NATIVE);
      nativeService.isNativeProject.mockReturnValue(true);
    });

    it("--json reads every service's log files, redacts secrets, and never asks Tilt", async () => {
      secrets.envSecretValues.mockReturnValue(["hunter2-secret"]);
      nativeRuntime.readNativeLogLines.mockReturnValue([
        line("api", "listening with token hunter2-secret"),
        line("frontend", "ready"),
      ]);

      const run = await runLogs(["--json", "--tail", "50"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBeUndefined();
      expect(envelope.errors).toEqual([]);
      expect(envelope.data).toMatchObject({ services: [], tail: 50, since: null });
      expect(envelope.data.lines.map((l: NativeLogLine) => l.text)).toEqual([
        "listening with token [REDACTED]",
        "ready",
      ]);
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith(
        "/project",
        ["api", "frontend"],
        {
          tail: 50,
          sinceMs: undefined,
          run: undefined,
        },
      );
      expect(tilt.isTiltAvailable).not.toHaveBeenCalled();
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("--json masks secret shapes and a private key spread over several lines", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([
        line("api", "Authorization: Bearer abcdef1234567890"),
        line("api", "-----" + "BEGIN PRIVATE KEY-----"),
        line("api", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"),
        line("api", "-----" + "END PRIVATE KEY-----"),
        line("frontend", "AKI" + "AIOSFODNN7EXAMPLE"),
        line("frontend", "ready"),
      ]);

      const run = await runLogs(["--json"]);
      const texts = parseEnvelope(run.stdout).data.lines.map((l: NativeLogLine) => l.text);

      expect(texts).toEqual([
        "Authorization: Bearer [REDACTED]",
        "[REDACTED]",
        "[REDACTED]",
        "[REDACTED]",
        "[REDACTED]",
        "ready",
      ]);
    });

    it("prints each line behind its service name, padded to the longest, with secrets redacted", async () => {
      secrets.envSecretValues.mockReturnValue(["hunter2-secret"]);
      nativeRuntime.readNativeLogLines.mockReturnValue([
        line("api", "token=hunter2-secret"),
        line("frontend", "ready"),
      ]);

      const run = await runLogs([]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("api      | token=[REDACTED]\nfrontend | ready\n");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("says so instead of printing nothing when the services have no log lines", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([]);

      const run = await runLogs([]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("No log lines yet for api, frontend.");
    });

    it("mentions --since in that message only when the user passed it", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([]);

      const run = await runLogs(["--since", "30s"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toContain("printed nothing in the last 30s.");
    });

    it("leaves --since out of the message when the user did not pass it", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([]);

      const run = await runLogs([]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).not.toContain("in the last");
    });

    it("rejects a service the project does not declare with UNKNOWN_SERVICE and exit 2", async () => {
      const run = await runLogs(["--json", "--service", "apii"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(2);
      expect(envelope.errors[0]).toMatchObject({ code: "UNKNOWN_SERVICE" });
      expect(envelope.errors[0]?.message).toContain("Unknown service apii");
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("defers a --service name a skipped service.json may own to the recorded run and its logs", async () => {
      mockDiscovery(NATIVE, [{ path: "/project/broken/service.json", reason: "invalid JSON" }]);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue(["broken-svc"]);
      nativeRuntime.readNativeLogLines.mockReturnValue([line("broken-svc", "still running")]);

      const run = await runLogs(["--service", "broken-svc"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("broken-svc | still running\n");
      expect(nativeRuntime.nativeServiceStates).toHaveBeenCalledWith("/project", [
        "api",
        "frontend",
        "broken-svc",
      ]);
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith("/project", ["broken-svc"], {
        tail: 200,
        sinceMs: undefined,
      });
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("uses the recorded native run when the only native service.json was skipped (real isNativeProject)", async () => {
      const actual = await vi.importActual<typeof import("../../utils/native-service.js")>(
        "../../utils/native-service.js",
      );
      nativeService.isNativeProject.mockImplementation(actual.isNativeProject);
      mockDiscovery([], [{ path: "/project/broken/service.json", reason: "invalid JSON" }]);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue(["broken-svc"]);
      nativeRuntime.readNativeRunState.mockReturnValue({
        pid: 4242,
        startedAt: "2026-11-22T00:00:00.000Z",
        services: { "broken-svc": { pid: 4243 } },
      });
      nativeRuntime.isNativeRunSupervisorAlive.mockResolvedValue(true);
      nativeRuntime.readNativeLogLines.mockReturnValue([line("broken-svc", "still running")]);

      const run = await runLogs(["--service", "broken-svc"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("broken-svc | still running\n");
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("asks Tilt, not the stale native record, when the recorded supervisor is no longer alive", async () => {
      mockDiscovery([], [{ path: "/project/broken/service.json", reason: "invalid JSON" }]);
      nativeService.isNativeProject.mockReturnValue(false);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue(["broken-svc"]);
      nativeRuntime.readNativeRunState.mockReturnValue({
        pid: 4242,
        startedAt: "2026-11-22T00:00:00.000Z",
        services: { "broken-svc": { pid: 4243 } },
      });
      nativeRuntime.isNativeRunSupervisorAlive.mockResolvedValue(false);
      tilt.runTilt
        .mockResolvedValueOnce(resourcesJson("broken-svc"))
        .mockResolvedValueOnce(ok("broken-svc | tilt logs\n"));

      const run = await runLogs(["--service", "broken-svc", "--port", "10351"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("broken-svc | tilt logs\n");
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("keeps complete discovery authoritative over stale native records", async () => {
      const actual = await vi.importActual<typeof import("../../utils/native-service.js")>(
        "../../utils/native-service.js",
      );
      nativeService.isNativeProject.mockImplementation(actual.isNativeProject);
      mockDiscovery([]);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue(["old-svc"]);
      tilt.runTilt.mockResolvedValueOnce(resourcesJson("api"));

      await runLogs(["--json", "--port", "10351"]);

      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
      expect(tilt.runTilt).toHaveBeenCalled();
    });

    it("masks secrets in the skipped-file warning", async () => {
      secrets.envSecretValues.mockReturnValue(["hunter2-secret"]);
      mockDiscovery(NATIVE, [
        { path: "/project/redact-case/service.json", reason: 'Unexpected token "hunter2-secret"' },
      ]);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue([]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      nativeRuntime.readNativeLogLines.mockReturnValue([]);

      await runLogs(["--service", "api"]);

      const printed = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("skipped /project/redact-case/service.json");
      expect(printed).not.toContain("hunter2-secret");
      warn.mockRestore();
    });

    it("still rejects a name that neither the parsed manifests nor the recorded run knows", async () => {
      mockDiscovery(NATIVE, [{ path: "/project/broken/service.json", reason: "invalid JSON" }]);
      nativeRuntime.recordedNativeServiceNames.mockReturnValue(["broken-svc"]);

      const run = await runLogs(["--json", "--service", "nope"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(2);
      expect(envelope.errors[0]).toMatchObject({ code: "UNKNOWN_SERVICE" });
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("--unhealthy --since reads only the failing services, from that long ago", async () => {
      nativeRuntime.nativeServiceStates.mockReturnValue({
        api: { status: "ready" },
        frontend: { status: "pending", reason: "starting" },
      });
      nativeRuntime.readNativeLogLines.mockReturnValue([line("frontend", "compiling")]);

      const run = await runLogs(["--json", "--unhealthy", "--since", "5m", "--grep", "compil"]);

      expect(run.status).toBeUndefined();
      expect(parseEnvelope(run.stdout).data).toMatchObject({
        since: "5m",
        lines: [{ resource: "frontend", text: "compiling", match: true }],
      });
      expect(nativeRuntime.nativeServiceStates).toHaveBeenCalledWith("/project", [
        "api",
        "frontend",
      ]);
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith("/project", ["frontend"], {
        tail: 200,
        sinceMs: 300_000,
        run: undefined,
      });
    });

    it("--run previous asks for the previous run and reports the selector in --json", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([
        line("api", "the failure", "2"),
        line("frontend", "still up", "2"),
      ]);

      const result = await runLogs(["--json", "--service", "api", "--run", "previous"]);
      const envelope = parseEnvelope(result.stdout);

      expect(result.status).toBeUndefined();
      expect(envelope.data).toMatchObject({
        run: "previous",
        lines: [
          { resource: "api", text: "the failure", run: "2" },
          { resource: "frontend", text: "still up", run: "2" },
        ],
      });
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith("/project", ["api"], {
        tail: 200,
        sinceMs: undefined,
        run: "previous",
      });
    });

    it("rejects a --run value that is not current, previous or a run id", async () => {
      const result = await runLogs(["--json", "--run", "latest"]);
      const envelope = parseEnvelope(result.stdout);

      expect(result.status).toBe(2);
      expect(envelope.errors[0]).toMatchObject({ code: "USAGE" });
      expect(envelope.errors[0]?.message).toContain("--run must be current, previous or a run id");
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("--unhealthy reports all healthy without reading log files when every service is ready", async () => {
      nativeRuntime.nativeServiceStates.mockReturnValue({
        api: { status: "ready" },
        frontend: { status: "ready" },
      });

      const run = await runLogs(["--json", "--unhealthy", "--service", "api"]);

      expect(parseEnvelope(run.stdout).data).toEqual({
        services: ["api"],
        tail: 200,
        since: null,
        run: null,
        lines: [],
        unhealthy: [],
        nextCursor: 0,
        truncated: false,
      });
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("--unhealthy --json names the blocker and the dependent it never started (#5109)", async () => {
      mockBlockedDependencyRun();

      const run = await runLogs(["--json", "--unhealthy"]);
      const data = parseEnvelope(run.stdout).data;

      expect(run.status).toBeUndefined();
      // The dependent that was never spawned is told apart from the service blocking it, and a
      // service that printed nothing this run is still named.
      expect(data.unhealthy).toEqual([
        {
          name: "db2",
          status: "pending",
          reason: "health check http://localhost:4003/health did not answer",
          didStart: true,
        },
        { name: "api", status: "pending", reason: "waiting for db2", didStart: false },
      ]);
      // Lines are scoped to this run's start, so nothing an earlier `flisk up` appended shows.
      const [, , readOptions] = nativeRuntime.readNativeLogLines.mock.calls[0] as unknown as [
        string,
        string[],
        { sinceMs?: number },
      ];
      expect(readOptions.sinceMs).toBeGreaterThanOrEqual(0);
      expect(readOptions.sinceMs).toBeLessThan(60_000);
    });

    it("--unhealthy --json intersects the named services with --service", async () => {
      const root = mockBlockedDependencyRun();

      const run = await runLogs(["--json", "--unhealthy", "--service", "api"]);

      expect(parseEnvelope(run.stdout).data.unhealthy).toEqual([
        { name: "api", status: "pending", reason: "waiting for db2", didStart: false },
      ]);
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith(
        root,
        ["api"],
        expect.objectContaining({ tail: 200 }),
      );
    });

    it("--unhealthy without a run on record names services without a didStart verdict", async () => {
      nativeRuntime.nativeServiceStates.mockReturnValue({
        frontend: { status: "pending", reason: "starting" },
      });
      nativeRuntime.readNativeLogLines.mockReturnValue([line("frontend", "compiling")]);

      const run = await runLogs(["--json", "--unhealthy"]);
      const data = parseEnvelope(run.stdout).data;

      expect(data.unhealthy).toEqual([{ name: "frontend", status: "pending", reason: "starting" }]);
      // No run start is on record, so the read is not time-scoped.
      expect(nativeRuntime.readNativeLogLines).toHaveBeenCalledWith("/project", ["frontend"], {
        tail: 200,
        sinceMs: undefined,
      });
    });

    it("--json numbers every line, returns nextCursor, and --after keeps only newer lines", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([
        numbered(10, "api", "one"),
        numbered(11, "frontend", "two"),
        numbered(12, "api", "three"),
      ]);

      const first = parseEnvelope((await runLogs(["--json"])).stdout).data;

      expect(first.lines.map((l: NativeLogLine) => l.seq)).toEqual([10, 11, 12]);
      expect(first.nextCursor).toBe(12);
      expect(first.truncated).toBe(false);

      nativeRuntime.readNativeLogLines.mockReturnValue([
        numbered(10, "api", "one"),
        numbered(11, "frontend", "two"),
        numbered(12, "api", "three"),
        numbered(13, "api", "four"),
      ]);
      const second = parseEnvelope((await runLogs(["--json", "--after", "12"])).stdout).data;

      expect(second.lines.map((l: NativeLogLine) => l.seq)).toEqual([13]);
      expect(second.nextCursor).toBe(13);
    });

    it("an unchanged log returns no lines and the same nextCursor", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([
        numbered(4, "api", "one"),
        numbered(5, "api", "two"),
      ]);
      const first = parseEnvelope((await runLogs(["--json"])).stdout).data;

      const second = parseEnvelope(
        (await runLogs(["--json", "--after", String(first.nextCursor)])).stdout,
      ).data;

      expect(second.lines).toEqual([]);
      expect(second.nextCursor).toBe(first.nextCursor);
      expect(second.truncated).toBe(false);
    });

    it("a cursor older than the retained log returns the oldest lines with truncated: true", async () => {
      nativeRuntime.readNativeLogLines.mockReturnValue([
        numbered(20, "api", "oldest kept"),
        numbered(21, "api", "newest kept"),
      ]);

      const data = parseEnvelope((await runLogs(["--json", "--after", "3"])).stdout).data;

      expect(data.lines.map((l: NativeLogLine) => l.text)).toEqual(["oldest kept", "newest kept"]);
      expect(data.truncated).toBe(true);
      expect(data.nextCursor).toBe(21);
    });

    it("rejects a non-integer --after cursor with a usage error", async () => {
      const run = await runLogs(["--json", "--after", "1.5"]);

      expect(run.status).toBe(2);
      expect(parseEnvelope(run.stdout).errors[0]).toMatchObject({ code: "USAGE" });
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });
  });

  it("rejects --run for a Docker project before asking Tilt", async () => {
    const result = await runLogs(["--json", "--run", "2"]);
    const envelope = parseEnvelope(result.stdout);

    expect(result.status).toBe(2);
    expect(envelope.errors[0]).toMatchObject({ code: "RUN_UNSUPPORTED" });
    expect(tilt.isTiltAvailable).not.toHaveBeenCalled();
    expect(tilt.runTilt).not.toHaveBeenCalled();
  });

  it("prints a text-mode usage error without suggestions and exits 2", async () => {
    const run = await runLogs(["--tail", "0"]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("--tail must be an integer from 1 to");
    expect(run.stderr).not.toContain("Suggestions");
  });

  describe("--service names against a container project", () => {
    beforeEach(() => {
      mockDiscovery([makeResource("api", "backend"), makeResource("web", "frontend")]);
      nativeService.isNativeProject.mockReturnValue(false);
    });

    it("reports an unknown name like restart does, before contacting Tilt", async () => {
      const run = await runLogs(["--service", "nope"]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('Resource "nope" not found in project.');
      expect(run.stderr).toContain("Resources: api, web");
      expect(run.stderr).toContain("See the names with: flisk resources");
      expect(tilt.isTiltAvailable).not.toHaveBeenCalled();
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("emits the restart UNKNOWN_RESOURCE code with the valid names in --json", async () => {
      const run = await runLogs(["--json", "--service", "nope"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(1);
      expect(envelope.errors[0]).toEqual({
        code: "UNKNOWN_RESOURCE",
        message: 'Resource "nope" not found in project.',
        suggestions: ["Resources: api, web", "See the names with: flisk resources"],
      });
      expect(tilt.isTiltAvailable).not.toHaveBeenCalled();
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("names the first service the project does not declare when several are passed", async () => {
      const run = await runLogs(["--json", "--service", "api", "nope"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(1);
      expect(envelope.errors[0]).toMatchObject({
        code: "UNKNOWN_RESOURCE",
        message: 'Resource "nope" not found in project.',
      });
      expect(tilt.runTilt).not.toHaveBeenCalled();
    });

    it("still reports TILT_NOT_RUNNING for a project service when the stack is down", async () => {
      tilt.runTilt.mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "connect: connection refused",
      });

      const run = await runLogs(["--json", "--service", "api", "--port", "59999"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(1);
      expect(envelope.errors[0]).toMatchObject({ code: "TILT_NOT_RUNNING" });
    });

    describe("when a service.json was skipped", () => {
      const problems: DiscoveryProblem[] = [
        { path: "/project/broken/service.json", reason: "invalid JSON" },
      ];

      it("defers a name the skipped manifest may own to the running Tilt's resource list", async () => {
        mockDiscovery([makeResource("api", "backend"), makeResource("web", "frontend")], problems);
        tilt.runTilt
          .mockResolvedValueOnce(resourcesJson("api", "web", "broken-svc"))
          .mockResolvedValueOnce(ok("broken-svc | hello\n"));

        const run = await runLogs(["--service", "broken-svc", "--port", "10351"]);

        expect(run.status).toBeUndefined();
        expect(run.stdout).toBe("broken-svc | hello\n");
        const args = tilt.runTilt.mock.calls[1]?.[1] as string[];
        expect(args.slice(args.indexOf("--") + 1)).toEqual(["broken-svc"]);
      });

      it("reports UNKNOWN_SERVICE, not UNKNOWN_RESOURCE, when the running Tilt does not list the name either", async () => {
        mockDiscovery([makeResource("api", "backend"), makeResource("web", "frontend")], problems);
        tilt.runTilt.mockResolvedValueOnce(resourcesJson("api", "web"));

        const run = await runLogs(["--json", "--service", "nope", "--port", "10351"]);
        const envelope = parseEnvelope(run.stdout);

        expect(run.status).toBe(2);
        expect(envelope.errors[0]).toMatchObject({ code: "UNKNOWN_SERVICE" });
        expect(tilt.runTilt).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("a project orchestrated by its own imported Tiltfile", () => {
    beforeEach(() => {
      mockDiscovery([makeResource("api", "backend")]);
      nativeService.isNativeProject.mockReturnValue(false);
      orchestration.isTiltfileOrchestration.mockReturnValue(true);
    });

    it("checks a Tiltfile resource's name against the running Tilt's list, not the manifest list", async () => {
      tilt.runTilt
        .mockResolvedValueOnce(resourcesJson("api", "tilt-svc"))
        .mockResolvedValueOnce(ok("tilt-svc | hi\n"));

      const run = await runLogs(["--service", "tilt-svc", "--port", "10351"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("tilt-svc | hi\n");
      const args = tilt.runTilt.mock.calls[1]?.[1] as string[];
      expect(args.slice(args.indexOf("--") + 1)).toEqual(["tilt-svc"]);
    });

    it("asks Tilt, not the native logs, even when every service.json declares command", async () => {
      mockDiscovery(NATIVE);
      nativeService.isNativeProject.mockReturnValue(true);
      tilt.runTilt
        .mockResolvedValueOnce(resourcesJson("api", "tilt-svc"))
        .mockResolvedValueOnce(ok("tilt-svc | hi\n"));

      const run = await runLogs(["--service", "tilt-svc", "--port", "10351"]);

      expect(run.status).toBeUndefined();
      expect(run.stdout).toBe("tilt-svc | hi\n");
      expect(nativeRuntime.readNativeLogLines).not.toHaveBeenCalled();
    });

    it("reports UNKNOWN_RESOURCE, as the manifest check does, for a name Tilt does not list", async () => {
      tilt.runTilt.mockResolvedValueOnce(resourcesJson("api"));

      const run = await runLogs(["--json", "--service", "nope", "--port", "10351"]);
      const envelope = parseEnvelope(run.stdout);

      expect(run.status).toBe(1);
      expect(envelope.errors[0]).toMatchObject({
        code: "UNKNOWN_RESOURCE",
        message: 'Resource "nope" not found in project.',
        suggestions: ["Resources: api", "See the names with: flisk resources"],
      });
      expect(tilt.runTilt).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back to Tilt when discovery throws, and still fetches logs when the resource list cannot be read", async () => {
    const badDiscovery = () => {
      throw new Error("bad manifest");
    };
    services.discoverResourcesFromRoot.mockImplementation(badDiscovery);
    services.discoverResourcesWithProblems.mockImplementation(badDiscovery);
    tilt.runTilt
      .mockRejectedValueOnce(new Error("spawn tilt ENOENT"))
      .mockResolvedValueOnce(ok("api | hello\n"));

    const run = await runLogs(["--service", "api", "--port", "10351"]);

    expect(run.status).toBeUndefined();
    expect(run.stdout).toBe("api | hello\n");
    expect(tilt.runTilt).toHaveBeenNthCalledWith(
      1,
      "get",
      ["uiresources", "-o", "json", "--port", "10351"],
      { inheritStdio: false },
    );
    expect(tilt.runTilt).toHaveBeenNthCalledWith(
      2,
      "logs",
      ["--port", "10351", "--tail", "200", "--", "api"],
      { inheritStdio: false },
    );
  });

  it("--unhealthy reports TILT_NOT_RUNNING when reading Tilt's resources throws", async () => {
    tilt.runTilt.mockRejectedValueOnce(new Error("connection refused"));

    const run = await runLogs(["--json", "--unhealthy"]);

    expect(run.status).toBe(1);
    expect(parseEnvelope(run.stdout).errors[0]).toMatchObject({ code: "TILT_NOT_RUNNING" });
    expect(tilt.runTilt).toHaveBeenCalledTimes(1);
  });

  it("--unhealthy reports TILT_NOT_RUNNING when Tilt's resource JSON cannot be parsed", async () => {
    tilt.runTilt.mockResolvedValueOnce(ok("not json"));

    const run = await runLogs(["--json", "--unhealthy"]);

    expect(run.status).toBe(1);
    expect(parseEnvelope(run.stdout).errors[0]).toMatchObject({ code: "TILT_NOT_RUNNING" });
    expect(tilt.runTilt).toHaveBeenCalledTimes(1);
  });

  it("--unhealthy uses Tilt's own states when the project's discovery fails", async () => {
    const badDiscovery = () => {
      throw new Error("bad manifest");
    };
    services.discoverResourcesFromRoot.mockImplementation(badDiscovery);
    services.discoverResourcesWithProblems.mockImplementation(badDiscovery);
    tilt.runTilt
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            items: [
              {
                metadata: { name: "api" },
                status: { updateStatus: "error", runtimeStatus: "none" },
              },
              { metadata: { name: "web" }, status: { updateStatus: "ok", runtimeStatus: "ok" } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(ok(""));

    const run = await runLogs(["--json", "--unhealthy"]);

    expect(run.status).toBeUndefined();
    expect(parseEnvelope(run.stdout).data).toMatchObject({ lines: [] });
    const args = tilt.runTilt.mock.calls[1]?.[1] as string[];
    expect(args).toContain("--json");
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["api"]);
  });
  it("--unhealthy reads the project's dependsOn edges alongside Tilt's states", async () => {
    mockDiscovery([
      makeResource("api", "backend"),
      makeResource("web", "frontend", { dependsOn: ["api"] }),
    ]);
    tilt.runTilt
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            items: [
              {
                metadata: { name: "api" },
                status: { updateStatus: "error", runtimeStatus: "none" },
              },
              { metadata: { name: "web" }, status: { updateStatus: "ok", runtimeStatus: "ok" } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(ok("api | crashed\n"));

    const run = await runLogs(["--unhealthy"]);

    expect(run.status).toBeUndefined();
    expect(run.stdout).toBe("api | crashed\n");
    expect(services.discoverResourcesWithProblems).toHaveBeenCalledWith("/project");
    const args = tilt.runTilt.mock.calls[1]?.[1] as string[];
    expect(args).not.toContain("--json");
    expect(args.slice(args.indexOf("--") + 1)).toContain("api");
  });
});
