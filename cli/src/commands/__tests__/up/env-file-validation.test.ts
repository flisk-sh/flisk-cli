// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  COMPLETE_ENV,
  captureExit,
  describe,
  discoverResourcesStrict,
  envFileFixture,
  expect,
  findProjectTiltPorts,
  it,
  join,
  makeResource,
  mkdtempSync,
  PROJECT_ENV_FILE_VAR,
  PROJECT_JSON,
  rmTreeBestEffort,
  runTilt,
  selectRunEnvFile,
  tmpdir,
  upCommand,
  vi,
  writeFileSync,
  writeSync,
} from "../../test-support/up.js";

const fixture = envFileFixture();

describe("flisk up --env-file", () => {
  it("selects the file for the run and points the engine at it", () => {
    writeFileSync(join(fixture.dir, ".env.integration"), COMPLETE_ENV);

    const selection = selectRunEnvFile(fixture.projectDir, ".env.integration");

    expect(selection?.path).toBe(join(fixture.projectDir, ".env.integration"));
    expect(selection?.relativePath).toBe(".env.integration");
  });

  it("leaves the env file of the run alone when no file is requested", () => {
    expect(selectRunEnvFile(fixture.dir, undefined)).toBeUndefined();
  });

  it("refuses a file that does not exist, before anything starts", () => {
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      expect(() => selectRunEnvFile(fixture.projectDir, ".env.integration")).toThrow(
        /Env file not found/,
      );
      expect(runTilt).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it("refuses a file outside the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "flisk-up-env-outside-"));
    try {
      writeFileSync(join(outside, ".env"), COMPLETE_ENV);
      expect(() => selectRunEnvFile(fixture.projectDir, join(outside, ".env"))).toThrow(
        /Env file is outside the project/,
      );
    } finally {
      rmTreeBestEffort(outside);
    }
  });

  it("refuses a file that misses a key the platform needs, without naming a value", () => {
    writeFileSync(
      join(fixture.dir, ".env.integration"),
      "TILT_ENV=dev\nDB_PASSWORD=topsecretvalue\n",
    );

    try {
      selectRunEnvFile(fixture.projectDir, ".env.integration");
      expect.unreachable("the missing key should stop the run");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("JWT_SECRET");
      expect(message).not.toContain("topsecretvalue");
    }
  });

  it("exits 2 on a missing file and never reaches Tilt", async () => {
    vi.mocked(runTilt).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      await expect(
        upCommand.parseAsync(["--env-file", ".env.integration"], { from: "user" }),
      ).rejects.toThrow("process.exit");

      expect(exit).toHaveBeenCalledWith(2);
      expect(runTilt).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Env file not found: .env.integration"),
      );
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it("writes the ENV_FILE_INVALID code to stdout in --json mode", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(writeSync).mockClear();
    let written = "";
    vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
      if (fd === 1) written += data;
      return data.length;
    }) as never);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

    await expect(
      upCommand.parseAsync(["--json", "--env-file", ".env.integration"], { from: "user" }),
    ).rejects.toThrow("process.exit");

    const payload = JSON.parse(written.trim().split("\n")[0] as string);
    expect(payload.errors[0].code).toBe("ENV_FILE_INVALID");
    expect(payload.errors[0].message).toContain(".env.integration");
    exit.mockRestore();
  });

  it.each([
    {
      name: "pinned version mismatch",
      versionConfig: { pinnedFliskVersion: "999.999.999" },
      expectedCode: "FLISK_VERSION_MISMATCH",
      expectedMessage: "pinnedFliskVersion",
    },
    {
      name: "minimum version failure",
      versionConfig: { minFliskVersion: "999.999.999" },
      expectedCode: "FLISK_VERSION_TOO_OLD",
      expectedMessage: "minFliskVersion",
    },
  ])(
    "writes the correct version error code for $name in --json mode",
    async ({ versionConfig, expectedCode, expectedMessage }) => {
      writeFileSync(
        join(fixture.projectDir, ".flisk", "project.json"),
        `${JSON.stringify({ ...PROJECT_JSON, ...versionConfig })}\n`,
      );

      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(writeSync).mockClear();

      let written = "";
      vi.mocked(writeSync).mockImplementation(((fd: number, data: string) => {
        if (fd === 1) written += data;
        return data.length;
      }) as never);

      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit");
      }) as never);

      await expect(upCommand.parseAsync(["--json", "--dry-run"], { from: "user" })).rejects.toThrow(
        "process.exit",
      );

      const payload = JSON.parse(written.trim().split("\n")[0] ?? "{}");

      expect(payload.errors[0].code).toBe(expectedCode);
      expect(payload.errors[0].message).toContain(expectedMessage);
      expect(runTilt).not.toHaveBeenCalled();

      exit.mockRestore();
    },
  );

  it("exports the selected file for the engine and names it in the output", async () => {
    writeFileSync(join(fixture.dir, ".env.integration"), COMPLETE_ENV);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await upCommand.parseAsync(["--dry-run", "--env-file", ".env.integration"], {
        from: "user",
      });
    } catch {
      // Later dry-run steps need a real project; the env file of the run is what matters here.
    }

    expect(process.env[PROJECT_ENV_FILE_VAR]).toBe(join(fixture.projectDir, ".env.integration"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(".env.integration"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("local-jwt-secret"));
    log.mockRestore();
  });

  it("refuses the option when a stack is already running, because it keeps its env file", async () => {
    writeFileSync(join(fixture.projectDir, ".env.integration"), COMPLETE_ENV);
    // One resource, so the run reaches the already-running check instead of the empty-project refusal (#3781).
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([
      makeResource("api", "backend", { schemaVersion: 1, port: 8080 }),
    ]);
    vi.mocked(findProjectTiltPorts).mockResolvedValue({
      running: [10350],
      foreign: [],
      savedRunning: [],
      unknownSaved: [],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();

    try {
      await expect(
        upCommand.parseAsync(["--quiet", "--env-file", ".env.integration"], { from: "user" }),
      ).rejects.toThrow("process.exit");

      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("--env-file applies to a new run only"),
      );
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
