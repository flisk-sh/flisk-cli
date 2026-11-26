// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  checkDockerVersions,
  checkFliskVersion,
  checkPrivateNpmRegistry,
  createVerdaccioProject,
  describe,
  expect,
  it,
  join,
  mkdirSync,
  rmSync,
  tmpdir,
  writeFileSync,
} from "./test-support.js";

describe("doctor private registry check without a Verdaccio license", () => {
  const projectWithVerdaccioEnabled = (npmrc?: string) =>
    createVerdaccioProject("flisk-doctor-registry-unlicensed", npmrc);

  const unreachable = (() => {
    throw new Error("Failed to connect to localhost port 4873");
  }) as unknown as typeof import("node:child_process").execSync;

  it("skips when the config enables Verdaccio but Flisk will not start it", () => {
    const projectRoot = projectWithVerdaccioEnabled();
    const result = checkPrivateNpmRegistry(
      unreachable,
      projectRoot,
      "http://localhost:4873",
      false,
    );
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("Premium license");
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("still checks a registry the project's own .npmrc points at", () => {
    const projectRoot = projectWithVerdaccioEnabled("@acme:registry=http://localhost:4873\n");
    const result = checkPrivateNpmRegistry(
      unreachable,
      projectRoot,
      "http://localhost:4873",
      false,
    );
    expect(result.didPass).toBe(false);
    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe("doctor Docker version check", () => {
  function fakeExec(engine: string, compose: string) {
    return (async (command: string) =>
      command.startsWith("docker compose") ? `${compose}\n` : `${engine}\n`) as never;
  }

  it("passes on Docker Engine 25+ and Compose 2.20.2+", async () => {
    const result = await checkDockerVersions(fakeExec("29.8.0", "2.39.1"));

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBeFalsy();
    expect(result.message).toContain("29.8.0");
  });

  it("fails with an upgrade hint when the engine is older than 25", async () => {
    const result = await checkDockerVersions(fakeExec("24.0.7", "2.39.1"));

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker Engine 24.0.7");
    expect(result.message).toContain("start_interval");
    expect(result.fix).toContain("Update Docker");
  });

  it("fails when Compose is older than 2.20.2", async () => {
    const result = await checkDockerVersions(fakeExec("27.1.1", "v2.20.1"));

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker Compose v2.20.1");
  });

  it("skips instead of failing when versions cannot be read", async () => {
    const result = await checkDockerVersions((() => {
      throw new Error("docker not found");
    }) as never);

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
  });

  it("skips when the Docker runtime reports an unknown version", async () => {
    const result = await checkDockerVersions(async () => "unknown");

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain('engine "unknown", compose "unknown"');
    expect(result.message).toContain("skipped version check");
  });
});

describe("doctor Flisk version pin", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(
      tmpdir(),
      `flisk-doctor-version-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(join(testDir, ".flisk"), { recursive: true });
    writeFileSync(join(testDir, "Tiltfile"), "");
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeProject(config: object) {
    writeFileSync(join(testDir, ".flisk", "project.json"), JSON.stringify(config));
  }

  it("warns when the project uses legacy minTdkVersion", () => {
    writeProject({ minTdkVersion: "1.3.80" });

    const result = checkFliskVersion("1.3.80");

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("minTdkVersion is deprecated");
  });

  it("skips when the project sets no minFliskVersion", () => {
    writeProject({});
    const result = checkFliskVersion("1.3.80");
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
  });

  it("passes when the CLI is at or above the minimum", () => {
    writeProject({ minFliskVersion: "1.3.80" });
    expect(checkFliskVersion("1.3.80").didPass).toBe(true);
    expect(checkFliskVersion("1.4.0").didPass).toBe(true);
  });

  it("fails and says to upgrade when the CLI is older", () => {
    writeProject({ minFliskVersion: "1.3.80" });
    const result = checkFliskVersion("1.3.79");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("1.3.79");
    expect(result.message).toContain("1.3.80");
    expect(result.fix).toBe("Run: flisk upgrade");
  });

  it("fails on a value that is not MAJOR.MINOR.PATCH", () => {
    writeProject({ minFliskVersion: "latest" });
    const result = checkFliskVersion("1.3.80");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("minFliskVersion");
  });

  it("passes when the CLI exactly matches the repository pin", () => {
    writeProject({ pinnedFliskVersion: "1.3.80" });

    const result = checkFliskVersion("1.3.80");

    expect(result.didPass).toBe(true);
    expect(result.message).toContain("matches pinnedFliskVersion 1.3.80");
  });

  it.each(["1.3.79", "1.3.81"])(
    "fails when the CLI version %s differs from the repository pin",
    (currentVersion) => {
      writeProject({ pinnedFliskVersion: "1.3.80" });

      const result = checkFliskVersion(currentVersion);

      expect(result.didPass).toBe(false);
      expect(result.message).toContain("pinnedFliskVersion 1.3.80");
      expect(result.fix).toContain("npm install -g @flisk-sh/flisk@1.3.80");
      expect(result.fix).toContain("edit pinnedFliskVersion");
    },
  );

  it("fails when the repository pin is malformed", () => {
    writeProject({ pinnedFliskVersion: "latest" });

    const result = checkFliskVersion("1.3.80");

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("pinnedFliskVersion");
  });
});
