// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  COMPLETE_ENV,
  captureExit,
  describe,
  discoverResourcesStrict,
  documentedExitCode,
  envFileFixture,
  expect,
  findAvailablePort,
  findProjectRoot,
  findProjectTiltPorts,
  getHostPortPlan,
  HOST_PORT_PLAN,
  it,
  join,
  listTiltInstances,
  makeResource,
  mkdirSync,
  PROJECT_ENV_FILE_VAR,
  PROJECT_JSON,
  readFileSync,
  requireProjectRoot,
  runTilt,
  SAVED_TILT_PLAN,
  stopOwnedTiltOnPort,
  stopTiltForUp,
  stripVTControlCharacters,
  tiltGetUiResources,
  upCommand,
  vi,
  writeFileSync,
  writeSavedHostPortPlan,
} from "../../test-support/up.js";

const fixture = envFileFixture();

describe("flisk up --env-file Tilt ownership", () => {
  it("reuses this project's Tilt on its saved port instead of starting a second Tilt (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    // Another project's Tilt holds 10350, so the first `flisk up` started this project's Tilt on 10351. A second `flisk up`
    // that looked at 10350 alone started another Tilt for the same Tiltfile on 10352.
    vi.mocked(findProjectTiltPorts).mockResolvedValue({
      running: [10351],
      foreign: [{ port: 10350, root: "/work/other" }],
      savedRunning: [10351],
      unknownSaved: [],
    });
    vi.mocked(getHostPortPlan).mockResolvedValueOnce(HOST_PORT_PLAN);
    vi.mocked(tiltGetUiResources).mockResolvedValueOnce(null);
    vi.mocked(runTilt).mockClear();
    upCommand.setOptionValue("quiet", false);
    upCommand.setOptionValue("envFile", undefined);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await upCommand.parseAsync([], { from: "user" });
    } finally {
      log.mockRestore();
    }

    const output = stripVTControlCharacters(lines.join("\n"));
    expect(runTilt).not.toHaveBeenCalled();
    expect(output).toContain("Environment is already running on port 10351.");
    expect(output).toContain("Tilt UI: http://localhost:10351");
    // The running Tilt's port stays saved, so a third `flisk up` finds it too.
    const saved = JSON.parse(
      readFileSync(join(fixture.projectDir, ".flisk", ".flisk-out", "host-ports.json"), "utf-8"),
    );
    expect(saved.tiltUi).toBe(10351);
  });

  it("preserves the saved Tilt port across --env-file and --only startup refusals so retry still finds it (#4165)", async () => {
    writeFileSync(join(fixture.projectDir, ".env.integration"), COMPLETE_ENV);
    writeSavedHostPortPlan(fixture.projectDir, SAVED_TILT_PLAN);
    const freshPlan = {
      ingressHttp: 8080,
      ingressHttps: 8443,
      postgres: 5432,
      requested: { ingressHttp: 8080, ingressHttps: 8443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "default", ingressHttps: "default", postgres: "default" },
    };
    vi.mocked(getHostPortPlan).mockResolvedValue(freshPlan);
    vi.mocked(findProjectTiltPorts).mockClear();
    vi.mocked(findProjectTiltPorts).mockImplementation(async ({ savedPort }) => ({
      running: savedPort === 10351 ? [10351] : [],
      foreign: [{ port: 10350, root: "/work/other" }],
      savedRunning: savedPort === 10351 ? [10351] : [],
      unknownSaved: [],
    }));
    vi.mocked(tiltGetUiResources).mockResolvedValue(null);
    vi.mocked(runTilt).mockClear();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      vi.mocked(discoverResourcesStrict).mockReturnValue([makeResource("api", "backend")]);
      await expect(
        upCommand.parseAsync(["--quiet", "--env-file", ".env.integration"], { from: "user" }),
      ).rejects.toThrow("process.exit");
      expect(exit).toHaveBeenCalledWith(1);

      let savedAfterEnvRefusal = JSON.parse(
        readFileSync(join(fixture.projectDir, ".flisk", ".flisk-out", "host-ports.json"), "utf-8"),
      );
      expect(savedAfterEnvRefusal.tiltUi).toBe(10351);

      upCommand.setOptionValue("envFile", undefined);
      vi.mocked(discoverResourcesStrict).mockReturnValue([makeResource("api", "backend")]);
      await expect(
        upCommand.parseAsync(["--quiet", "--only", "api"], { from: "user" }),
      ).rejects.toThrow("process.exit");
      expect(exit).toHaveBeenCalledTimes(2);

      savedAfterEnvRefusal = JSON.parse(
        readFileSync(join(fixture.projectDir, ".flisk", ".flisk-out", "host-ports.json"), "utf-8"),
      );
      expect(savedAfterEnvRefusal.tiltUi).toBe(10351);

      upCommand.setOptionValue("only", undefined);
      upCommand.setOptionValue("quiet", false);
      await upCommand.parseAsync([], { from: "user" });

      expect(vi.mocked(findProjectTiltPorts).mock.calls.map((c) => c[0]?.savedPort)).toEqual([
        10351, 10351, 10351,
      ]);
      expect(runTilt).not.toHaveBeenCalled();
    } finally {
      vi.mocked(discoverResourcesStrict).mockReturnValue([]);
      upCommand.setOptionValue("envFile", undefined);
      upCommand.setOptionValue("only", undefined);
      upCommand.setOptionValue("quiet", false);
      exit.mockRestore();
      error.mockRestore();
      log.mockRestore();
    }
  });

  const savedTiltPlan = SAVED_TILT_PLAN;

  it("refuses flisk up --force instead of starting a second Tilt beside a saved listener with unknown ownership (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    writeSavedHostPortPlan(fixture.projectDir, savedTiltPlan);
    const actualPortOwner = await vi.importActual<
      typeof import("../../../utils/tilt-port-owner.js")
    >("../../../utils/tilt-port-owner.js");
    vi.mocked(findProjectTiltPorts).mockImplementationOnce((opts) =>
      actualPortOwner.findProjectTiltPorts({
        ...opts,
        isServing: async (port) => port === 10350 || port === 10351,
        ownerOf: (port) => (port === 10350 ? { pid: 2, root: "/work/other" } : null),
      }),
    );
    vi.mocked(findAvailablePort).mockResolvedValueOnce(10352);
    vi.mocked(stopOwnedTiltOnPort).mockClear();
    vi.mocked(stopTiltForUp).mockClear();
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      await expect(upCommand.parseAsync(["--quiet", "--force"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("saved port 10351"));
      expect(runTilt).not.toHaveBeenCalled();
      expect(stopTiltForUp).not.toHaveBeenCalled();
      expect(stopOwnedTiltOnPort).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      error.mockRestore();
      upCommand.setOptionValue("force", false);
      upCommand.setOptionValue("quiet", false);
    }
  });

  it("does not report an unknown-owner saved listener as this project's Tilt on an ordinary flisk up (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    writeSavedHostPortPlan(fixture.projectDir, savedTiltPlan);
    const actualPortOwner = await vi.importActual<
      typeof import("../../../utils/tilt-port-owner.js")
    >("../../../utils/tilt-port-owner.js");
    vi.mocked(findProjectTiltPorts).mockImplementationOnce((opts) =>
      actualPortOwner.findProjectTiltPorts({
        ...opts,
        isServing: async (port) => port === 10351,
        ownerOf: () => null,
      }),
    );
    vi.mocked(runTilt).mockClear();
    vi.mocked(runTilt).mockImplementationOnce(() => {
      throw new Error("STOP_BEFORE_WAIT");
    });
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await expect(upCommand.parseAsync(["--quiet"], { from: "user" })).rejects.toThrow(
        "STOP_BEFORE_WAIT",
      );
      expect(runTilt).toHaveBeenCalled();
      expect(lines.join("\n")).not.toContain("already running");
    } finally {
      upCommand.setOptionValue("quiet", false);
      log.mockRestore();
    }
  });

  it("aborts --force before starting Tilt when the saved Tilt is still serving after the stop (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    writeSavedHostPortPlan(fixture.projectDir, savedTiltPlan);
    vi.mocked(findProjectTiltPorts).mockResolvedValueOnce({
      running: [10351],
      foreign: [],
      savedRunning: [10351],
      unknownSaved: [],
    });
    vi.mocked(findAvailablePort).mockResolvedValueOnce(10352);
    // The ownership re-check refuses the stop (returns nothing) and the original Tilt keeps answering.
    vi.mocked(stopOwnedTiltOnPort).mockReturnValueOnce([]);
    vi.mocked(tiltGetUiResources).mockResolvedValue({} as never);
    vi.mocked(stopTiltForUp).mockImplementationOnce(async () => {});
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      // Waits the real 5 s grace period for the saved Tilt to stop before giving up.
      await expect(upCommand.parseAsync(["--quiet", "--force"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("port 10351 is still running"));
      expect(runTilt).not.toHaveBeenCalled();
    } finally {
      vi.mocked(tiltGetUiResources).mockResolvedValue(null);
      exit.mockRestore();
      error.mockRestore();
      upCommand.setOptionValue("force", false);
      upCommand.setOptionValue("quiet", false);
    }
  });

  it("prefers confirmed saved-port ownership over an unknown listener on 10350 (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    writeSavedHostPortPlan(fixture.projectDir, SAVED_TILT_PLAN);
    const actualPortOwner = await vi.importActual<
      typeof import("../../../utils/tilt-port-owner.js")
    >("../../../utils/tilt-port-owner.js");
    vi.mocked(findProjectTiltPorts).mockImplementationOnce((opts) =>
      actualPortOwner.findProjectTiltPorts({
        ...opts,
        isServing: async (port) => port === 10350 || port === 10351,
        ownerOf: (port) => (port === 10351 ? { pid: 1, root: fixture.projectDir } : null),
      }),
    );
    vi.mocked(getHostPortPlan).mockResolvedValueOnce(HOST_PORT_PLAN);
    vi.mocked(tiltGetUiResources).mockResolvedValueOnce(null);
    vi.mocked(runTilt).mockClear();
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await upCommand.parseAsync([], { from: "user" });
      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toContain("Environment is already running on port 10351.");
      expect(runTilt).not.toHaveBeenCalled();
      const saved = JSON.parse(
        readFileSync(join(fixture.projectDir, ".flisk", ".flisk-out", "host-ports.json"), "utf-8"),
      );
      expect(saved.tiltUi).toBe(10351);
    } finally {
      log.mockRestore();
    }
  });

  it("picks an available port instead of an occupied non-Tilt base port under --force (#4165)", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("api", "backend")]);
    writeSavedHostPortPlan(fixture.projectDir, SAVED_TILT_PLAN);
    vi.mocked(findProjectTiltPorts).mockResolvedValueOnce({
      running: [10351],
      foreign: [],
      savedRunning: [10351],
      unknownSaved: [],
    });
    vi.mocked(findAvailablePort).mockResolvedValueOnce(10352);
    vi.mocked(stopOwnedTiltOnPort).mockClear();
    vi.mocked(stopTiltForUp).mockClear();
    vi.mocked(runTilt).mockClear();
    vi.mocked(runTilt).mockImplementationOnce(() => {
      throw new Error("STOP_BEFORE_WAIT");
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(upCommand.parseAsync(["--quiet", "--force"], { from: "user" })).rejects.toThrow(
        "STOP_BEFORE_WAIT",
      );
      expect(stopTiltForUp).toHaveBeenCalledWith(
        expect.objectContaining({ force: false, port: 10352, ownPorts: [10351] }),
        expect.anything(),
      );
      expect(stopOwnedTiltOnPort).toHaveBeenCalledWith(10351, fixture.projectDir);
      expect(process.env.TILT_PORT).toBe("10352");
      const saved = JSON.parse(
        readFileSync(join(fixture.projectDir, ".flisk", ".flisk-out", "host-ports.json"), "utf-8"),
      );
      expect(saved.tiltUi).toBe(10352);
    } finally {
      upCommand.setOptionValue("force", false);
      upCommand.setOptionValue("quiet", false);
      log.mockRestore();
    }
  });

  it("keeps the project .env as the env file of the run when no file is requested", async () => {
    // An inherited variable must not change the default either.
    vi.stubEnv(PROJECT_ENV_FILE_VAR, "/somewhere/else/.env");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await upCommand.parseAsync(["--dry-run"], { from: "user" });
    } catch {
      // Later dry-run steps need a real project.
    }

    expect(process.env[PROJECT_ENV_FILE_VAR]).toBeUndefined();
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("Using env file"));
    log.mockRestore();
  });

  it("documents the exit code it returns for a rejected --env-file", () => {
    expect(documentedExitCode("rejected `--env-file`")).toBe(2);
  });

  it("prints the collision-suffixed worktree host in URLs before starting Tilt (#4697)", async () => {
    const worktreeRoot = join(fixture.dir, "Feature.Login");
    mkdirSync(join(worktreeRoot, ".flisk"), { recursive: true });
    writeFileSync(join(worktreeRoot, ".git"), "gitdir: ../.git/worktrees/feature-login\n");
    writeFileSync(
      join(worktreeRoot, ".flisk", "project.json"),
      `${JSON.stringify(PROJECT_JSON)}\n`,
    );
    vi.mocked(findProjectRoot).mockReturnValue(worktreeRoot);
    vi.mocked(requireProjectRoot).mockReturnValue(worktreeRoot);
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([makeResource("web", "frontend")]);
    vi.mocked(getHostPortPlan).mockResolvedValueOnce(HOST_PORT_PLAN);
    vi.mocked(listTiltInstances).mockReturnValueOnce([
      { pid: 42, root: join(fixture.dir, "other", "Feature.Login") },
    ]);
    vi.mocked(runTilt)
      .mockClear()
      .mockImplementationOnce(() => {
        throw new Error("STOP_BEFORE_WAIT");
      });

    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      await expect(upCommand.parseAsync([], { from: "user" })).rejects.toThrow("STOP_BEFORE_WAIT");
      const output = stripVTControlCharacters(lines.join("\n"));
      const id = process.env.FLISK_CHECKOUT_ID ?? "";
      expect(id).toMatch(/^[0-9a-f]{8}$/);
      expect(output).toContain(
        `web: http://app.feature-login-${id.slice(0, 4)}.flisk-project.localhost:8080/web`,
      );
      expect(output).toContain(`this one uses feature-login-${id.slice(0, 4)}.`);
      expect(
        JSON.parse(readFileSync(join(worktreeRoot, ".flisk", ".project-id"), "utf-8")),
      ).toEqual(expect.objectContaining({ hostSuffix: `-${id.slice(0, 4)}` }));
    } finally {
      upCommand.setOptionValue("quiet", false);
      log.mockRestore();
    }
  });

  it("leaves a running stack's recorded host alone when --only refuses to replace it (#4697)", async () => {
    const worktreeRoot = join(fixture.dir, "Feature.Login");
    mkdirSync(join(worktreeRoot, ".flisk"), { recursive: true });
    writeFileSync(join(worktreeRoot, ".git"), "gitdir: ../.git/worktrees/feature-login\n");
    writeFileSync(
      join(worktreeRoot, ".flisk", "project.json"),
      `${JSON.stringify(PROJECT_JSON)}\n`,
    );
    vi.mocked(findProjectRoot).mockReturnValue(worktreeRoot);
    vi.mocked(requireProjectRoot).mockReturnValue(worktreeRoot);
    vi.mocked(discoverResourcesStrict).mockReturnValue([makeResource("web", "frontend")]);
    vi.mocked(getHostPortPlan).mockResolvedValue(HOST_PORT_PLAN);
    vi.mocked(listTiltInstances).mockReturnValue([
      { pid: 42, root: join(fixture.dir, "other", "Feature.Login") },
    ]);
    vi.mocked(findProjectTiltPorts).mockResolvedValue({
      running: [10350],
      foreign: [],
      savedRunning: [10350],
      unknownSaved: [],
    });
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      await expect(upCommand.parseAsync(["--only", "web"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );
      expect(runTilt).not.toHaveBeenCalled();
      // The collision suffix is for the run that starts Tilt; a refusal must not rewrite the running stack's host.
      expect(
        JSON.parse(readFileSync(join(worktreeRoot, ".flisk", ".project-id"), "utf-8")).hostSuffix,
      ).toBeUndefined();
    } finally {
      vi.mocked(discoverResourcesStrict).mockReturnValue([]);
      upCommand.setOptionValue("only", undefined);
      upCommand.setOptionValue("quiet", false);
      exit.mockRestore();
      error.mockRestore();
      log.mockRestore();
    }
  });
});
