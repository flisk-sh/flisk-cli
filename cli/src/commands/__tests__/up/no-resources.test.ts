// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  captureExit,
  checkPrintedUrls,
  describe,
  discoverResourcesStrict,
  expect,
  findProjectRoot,
  findProjectTiltPorts,
  getHostPortPlan,
  HOST_PORT_PLAN,
  isTiltfileOrchestration,
  it,
  join,
  makeResource,
  mkdirSync,
  mkdtempSync,
  PROJECT_JSON,
  readFastNoopState,
  requireProjectRoot,
  rmTreeBestEffort,
  runTilt,
  stubGeneratedProject,
  tmpdir,
  upCommand,
  verifyMasterConfigs,
  vi,
  waitForTiltResourcesReady,
  writeFastNoopState,
  writeFileSync,
  writeSync,
} from "../../test-support/up.js";

describe("flisk up with no resources (#3781)", () => {
  beforeEach(() => {
    stubGeneratedProject();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("flisk up --dry-run refuses an empty project before Tilt and never reaches it", async () => {
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      await expect(upCommand.parseAsync(["--dry-run"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(runTilt).not.toHaveBeenCalled();
      const output = error.mock.calls.flat().join("\n");
      expect(output).toContain("This project has no resources yet, so there is nothing to start.");
      expect(output).toContain("Add one: flisk resource api --type backend --stack main");
      expect(output).toContain("Or start from a template: flisk create");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it("flisk up (not a dry run) refuses an empty project and never reaches Tilt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-empty-"));
    try {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(join(dir, ".flisk", "project.json"), `${JSON.stringify(PROJECT_JSON)}\n`);
      vi.mocked(findProjectRoot).mockReturnValue(dir);
      vi.mocked(requireProjectRoot).mockReturnValue(dir);
      vi.mocked(runTilt).mockClear();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();

      try {
        await expect(upCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");
        expect(exit).toHaveBeenCalledWith(1);
        expect(runTilt).not.toHaveBeenCalled();
        expect(error.mock.calls.flat().join("\n")).toContain("no resources yet");
      } finally {
        exit.mockRestore();
        error.mockRestore();
      }
    } finally {
      rmTreeBestEffort(dir);
    }
  });

  it("--json writes the NO_RESOURCES object to stdout before exiting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(writeSync).mockClear();
    let written = "";
    vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
      if (fd === 1) written += data;
      return data.length;
    }) as never);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      expect(written).toContain('"NO_RESOURCES"');
      throw new Error("process.exit");
    }) as never);

    try {
      await expect(upCommand.parseAsync(["--json", "--dry-run"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );
      const payload = JSON.parse(written.trim().split("\n")[0] as string);
      expect(payload.data.ok).toBe(false);
      expect(payload.errors[0].code).toBe("NO_RESOURCES");
      expect(payload.errors[0].message).toContain("no resources yet");
      expect(payload.errors[0].suggestions).toEqual([
        "Add one: flisk resource api --type backend --stack main",
        "Or start from a template: flisk create",
      ]);
      expect(runTilt).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  /** Runs `flisk up <args>` in the empty project, returning what it printed to stderr and stdout and the exit codes. */
  async function upInEmptyProject(args: string[]) {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runTilt).mockClear();
    vi.mocked(writeSync).mockClear();
    const stdout: string[] = [];
    vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
      if (fd === 1) stdout.push(data);
      return data.length;
    }) as never);
    const { exit } = captureExit();
    await expect(upCommand.parseAsync(args, { from: "user" })).rejects.toThrow("process.exit");
    const result = {
      err: stderr.mock.calls.flat().join("\n"),
      out: stdout.join(""),
      codes: exit.mock.calls.map(([code]) => code),
    };
    exit.mockRestore();
    stderr.mockRestore();
    return result;
  }

  it("--dry-run --only gets the plain no-resources refusal, not an unknown service (#4966)", async () => {
    const { err, codes } = await upInEmptyProject(["--dry-run", "--only", "nope"]);
    expect(codes).toEqual([1]);
    expect(runTilt).not.toHaveBeenCalled();
    expect(err).toContain("no resources yet, so there is nothing to start.");
    expect(err).toContain("Or start from a template: flisk create");
    expect(err).not.toMatch(/Unknown service|Valid names:/);
  });

  it("--json --only reports NO_RESOURCES with the same suggestions as plain up (#4966)", async () => {
    const { out } = await upInEmptyProject(["--json", "--dry-run", "--only", "nope"]);
    const { errors } = JSON.parse(out.trim().split("\n")[0] as string);
    expect(errors.map((e: { code: string }) => e.code)).toEqual(["NO_RESOURCES"]);
    expect(errors[0].suggestions).toHaveLength(2);
  });

  it("--dry-run --only does not refuse as empty when a declared repository is not cloned yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-pending-"));
    try {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(
        join(dir, ".flisk", "project.json"),
        `${JSON.stringify({ ...PROJECT_JSON, repos: [{ url: "https://example.com/org/api.git", dir: "api-repo" }] })}\n`,
      );
      vi.mocked(findProjectRoot).mockReturnValue(dir);
      vi.mocked(requireProjectRoot).mockReturnValue(dir);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await upCommand.parseAsync(["--dry-run", "--only", "api"], { from: "user" });
      } catch {
        // Later dry-run steps need a real project; the empty-project refusal is what matters here.
      }

      expect(warn.mock.calls.flat().join("\n")).toContain("Pending clone: api");
      expect(error.mock.calls.flat().join("\n")).not.toContain("no resources yet");
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    } finally {
      rmTreeBestEffort(dir);
    }
  });

  it("reports every failed declared repository, not only the first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-repos-fail-"));
    try {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(
        join(dir, ".flisk", "project.json"),
        `${JSON.stringify({
          ...PROJECT_JSON,
          repos: [
            { url: join(dir, "nope-a.git"), dir: "repo-a" },
            { url: join(dir, "nope-b.git"), dir: "repo-b" },
          ],
        })}\n`,
      );
      vi.mocked(findProjectRoot).mockReturnValue(dir);
      vi.mocked(requireProjectRoot).mockReturnValue(dir);
      vi.mocked(runTilt).mockClear();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();

      try {
        await expect(upCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");
        expect(exit).toHaveBeenCalledWith(1);
        expect(runTilt).not.toHaveBeenCalled();
        const output = error.mock.calls.flat().join("\n");
        expect(output).toContain("Failed to clone 2 configured repositories");
        expect(output).toContain("repo-a");
        expect(output).toContain("repo-b");
      } finally {
        exit.mockRestore();
        error.mockRestore();
      }
    } finally {
      rmTreeBestEffort(dir);
    }
  });

  it("a project with one resource is unchanged", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([
      makeResource("api", "backend", { schemaVersion: 1, port: 8080 }),
    ]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await upCommand.parseAsync(["--dry-run"], { from: "user" });
    } catch {
      // Later dry-run steps need a real project; the empty-project refusal is what matters here.
    }

    expect(log.mock.calls.flat().join("\n")).toContain("Would start 1 service");
    expect(error.mock.calls.flat().join("\n")).not.toContain("no resources yet");
    log.mockRestore();
    error.mockRestore();
  });

  it("still runs a project that wraps its own Tiltfile", async () => {
    vi.mocked(isTiltfileOrchestration).mockReturnValue(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await upCommand.parseAsync(["--dry-run"], { from: "user" });
    } catch {
      // Later dry-run steps need a real project; the empty-project refusal is what matters here.
    }

    expect(error.mock.calls.flat().join("\n")).not.toContain("no resources yet");
    log.mockRestore();
    error.mockRestore();
  });

  it("rejects already-running --json when printed URLs do not answer and clears cached state (#4193)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-already-url-"));
    try {
      mkdirSync(join(dir, ".flisk", ".flisk-out"), { recursive: true });
      writeFileSync(join(dir, ".flisk", "project.json"), `${JSON.stringify(PROJECT_JSON)}\n`);
      writeFileSync(join(dir, ".flisk", ".flisk-out", "Tiltfile"), "# tilt\n");
      vi.mocked(findProjectRoot).mockReturnValue(dir);
      vi.mocked(requireProjectRoot).mockReturnValue(dir);
      vi.mocked(discoverResourcesStrict).mockReturnValue([
        makeResource("api", "backend", { schemaVersion: 1, port: 8080 }),
      ]);
      vi.mocked(findProjectTiltPorts).mockResolvedValueOnce({
        running: [10350],
        foreign: [],
        savedRunning: [10350],
        unknownSaved: [],
      });
      vi.mocked(getHostPortPlan).mockResolvedValueOnce(HOST_PORT_PLAN);
      vi.mocked(waitForTiltResourcesReady).mockResolvedValueOnce({
        ready: true,
        pending: 0,
        failures: [],
        enabled: ["api"],
        timedOut: false,
      });
      vi.mocked(checkPrintedUrls).mockResolvedValueOnce([
        { service: "api", url: "http://api.shop.localhost:8080/api/api", didAnswer: false },
      ]);
      writeFastNoopState(dir, {
        version: 1,
        fingerprint: "stale",
        tiltPort: 10350,
        tiltPid: 123,
        stack: null,
        services: ["api"],
        ingressPort: 8080,
        urls: ["http://api.shop.localhost:8080/api/api"],
      });

      let written = "";
      vi.mocked(writeSync).mockImplementation((_fd, data) => {
        written += String(data);
        return String(data).length;
      });
      const prevCode = process.exitCode;
      process.exitCode = undefined;

      try {
        await upCommand.parseAsync(["--json"], { from: "user" });
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = prevCode;
      }

      const envelope = JSON.parse(written.trim().split("\n").pop() as string);
      expect(envelope.data.ok).toBe(false);
      expect(envelope.data.alreadyRunning).toBe(true);
      expect(envelope.errors[0]?.code).toBe("UP_URL_UNREACHABLE");
      expect(readFastNoopState(dir)).toBeNull();
    } finally {
      rmTreeBestEffort(dir);
    }
  });
});
