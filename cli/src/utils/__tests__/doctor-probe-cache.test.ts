// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckResult } from "../../types/index.js";
import { checkDockerFileSharing } from "../docker-file-sharing.js";
import { checkDockerNetworkCapacity } from "../doctor/checks/docker-networks.js";
import { checkDockerOperatingSystem } from "../doctor-container.js";
import {
  CACHED_MARK,
  clearDoctorProbes,
  createDoctorProbeEnvironment,
  DOCTOR_PROBE_TTL_MS,
  type DoctorProbeEnvironment,
  readDoctorProbe,
  writeDoctorProbe,
} from "../doctor-probe-cache.js";
import {
  checkDockerVersions,
  DOCKER_SERVER_JSON_COMMAND,
  parseDockerServerJson,
} from "../doctor-tools.js";
import type { ExecAsync } from "../exec-async.js";
import { cacheExecAsync, createAsyncCommandCache } from "../host-command-cache.js";

describe("parseDockerServerJson", () => {
  it("reads Version and Os from the rendered server JSON", () => {
    const server = parseDockerServerJson(
      '{"Platform":{"Name":"Docker Desktop"},"Version":"29.8.0","Os":"linux","Arch":"arm64"}',
    );
    expect(server).toEqual({ version: "29.8.0", os: "linux" });
  });

  it("accepts a Server wrapper the way {{json .}} renders it", () => {
    const server = parseDockerServerJson('{"Server":{"Version":"28.1.0","Os":"windows"}}');
    expect(server).toEqual({ version: "28.1.0", os: "windows" });
  });

  it("returns null when the output is not JSON", () => {
    expect(parseDockerServerJson("29.8.0")).toBeNull();
    expect(parseDockerServerJson("")).toBeNull();
    expect(parseDockerServerJson("linux\n")).toBeNull();
  });

  it("keeps only the fields it knows", () => {
    expect(parseDockerServerJson('{"Arch":"amd64"}')).toEqual({});
    expect(parseDockerServerJson("[1,2]")).toBeNull();
    expect(parseDockerServerJson('"linux"')).toBeNull();
  });
});

describe("checkDockerVersions with the shared server call", () => {
  const versionsExec = (server: string, compose: string): ExecAsync => {
    return async (command: string) =>
      command.startsWith("docker compose") ? `${compose}\n` : `${server}\n`;
  };

  it("reads the engine version out of the server JSON", async () => {
    const result = await checkDockerVersions(
      versionsExec('{"Version":"29.8.0","Os":"linux"}', "2.39.1"),
    );
    expect(result.didPass).toBe(true);
    expect(result.message).toContain("29.8.0");
    expect(result.message).toContain("2.39.1");
  });

  it("still reads a plain-text version from an engine without the JSON template", async () => {
    const result = await checkDockerVersions(versionsExec("24.0.7", "2.39.1"));
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker Engine 24.0.7");
  });

  it("skips when the server JSON has no Version field", async () => {
    const result = await checkDockerVersions(versionsExec('{"Os":"linux"}', "2.39.1"));
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("skipped version check");
  });
});

describe("checkDockerOperatingSystem", () => {
  it("asks docker version for the server section, not docker info", async () => {
    const commands: string[] = [];
    const exec = (async (command: string) => {
      commands.push(command);
      return '{"Os":"linux","Version":"29.8.0"}';
    }) as ExecAsync;
    const result = await checkDockerOperatingSystem(exec);
    expect(result.didPass).toBe(true);
    expect(commands).toEqual([DOCKER_SERVER_JSON_COMMAND]);
  });

  it("fails closed on a Windows engine in the server JSON", async () => {
    const result = await checkDockerOperatingSystem(async () => '{"Os":"windows"}');
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("requires Linux containers");
    expect(result.fix).toContain("docker version --format '{{.Server.Os}}'");
  });

  it("fails closed on a plain-text Windows answer like the old docker info call returned", async () => {
    const result = await checkDockerOperatingSystem(async () => "windows");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("requires Linux containers");
  });

  it("skips when the server JSON carries no Os field", async () => {
    const result = await checkDockerOperatingSystem(async () => '{"Version":"29.8.0"}');
    expect(result.isSkipped).toBe(true);
    expect(result.didPass).toBe(true);
  });

  it("skips when the version call fails", async () => {
    const result = await checkDockerOperatingSystem(async () => {
      throw new Error("daemon down");
    });
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("daemon failure reported separately");
  });

  it("shares one docker version call with the versions check and the probe environment", async () => {
    const calls: string[] = [];
    const exec = (async (command: string) => {
      calls.push(command);
      if (command === DOCKER_SERVER_JSON_COMMAND) return '{"Os":"linux","Version":"29.8.0"}\n';
      return "2.39.1\n";
    }) as ExecAsync;
    const cachedExec = cacheExecAsync(exec, createAsyncCommandCache());

    const [os, versions, env] = await Promise.all([
      checkDockerOperatingSystem(cachedExec),
      checkDockerVersions(cachedExec),
      createDoctorProbeEnvironment(cachedExec, { home: "/tmp/unused" }),
    ]);

    expect(calls.filter((command) => command === DOCKER_SERVER_JSON_COMMAND)).toHaveLength(1);
    expect(os.didPass).toBe(true);
    expect(versions.didPass).toBe(true);
    expect(env.version).toBe("29.8.0");
  });
});

describe("createDoctorProbeEnvironment", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flisk-probe-env-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("keys the identity on DOCKER_HOST and the docker context", async () => {
    const exec = (async () => '{"Version":"29.8.0"}') as ExecAsync;
    const env = await createDoctorProbeEnvironment(exec, {
      home,
      env: { DOCKER_HOST: "tcp://example:2375", DOCKER_CONTEXT: "remote" },
    });
    expect(env.daemon).toBe("tcp://example:2375|remote");
    expect(env.version).toBe("29.8.0");
    expect(env.enabled).toBe(true);
  });

  it("keeps a plain-text version answer as the version", async () => {
    const exec = (async () => "29.8.0\n") as ExecAsync;
    const env = await createDoctorProbeEnvironment(exec, { home, env: {} });
    expect(env.version).toBe("29.8.0");
  });

  it("builds an identity with an empty version when docker version cannot be read", async () => {
    const exec = (async () => {
      throw new Error("daemon down");
    }) as ExecAsync;
    const env = await createDoctorProbeEnvironment(exec, {
      home,
      env: { DOCKER_CONTEXT: "colima" },
    });
    expect(env.version).toBe("");
    expect(env.daemon).toBe("|colima");
  });
});

describe("readDoctorProbe and writeDoctorProbe", () => {
  let home: string;
  let now: number;
  let env: DoctorProbeEnvironment;

  const verdict: CheckResult = {
    name: "Docker networks",
    didPass: true,
    message: "Docker can create networks",
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flisk-probe-stamp-"));
    now = 1_000_000;
    env = { daemon: "|default", version: "29.8.0", enabled: true, home, now: () => now };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("returns a fresh verdict marked (cached) inside the TTL", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    const cached = readDoctorProbe(env, "probe-a", "/project", "Docker networks");
    expect(cached).toEqual({
      name: "Docker networks",
      didPass: true,
      isWarning: undefined,
      message: `Docker can create networks${CACHED_MARK}`,
      fix: undefined,
    });
  });

  it("keeps the fix on a cached failure", () => {
    writeDoctorProbe(env, "probe-a", "/project", {
      name: "Docker networks",
      didPass: false,
      message: "Docker cannot create another network",
      fix: "flisk doctor --fix",
    });
    const cached = readDoctorProbe(env, "probe-a", "/project", "Docker networks");
    expect(cached?.didPass).toBe(false);
    expect(cached?.fix).toBe("flisk doctor --fix");
    expect(cached?.message).toContain(CACHED_MARK);
  });

  it("misses after the TTL and before the checkedAt time", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    now += DOCTOR_PROBE_TTL_MS;
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")).toBeUndefined();
    now -= 2 * DOCTOR_PROBE_TTL_MS;
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")).toBeUndefined();
  });

  it("misses on a different scope, daemon or server version", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    expect(readDoctorProbe(env, "probe-a", "/other", "Docker networks")).toBeUndefined();
    expect(
      readDoctorProbe({ ...env, daemon: "|other" }, "probe-a", "/project", "Docker networks"),
    ).toBeUndefined();
    expect(
      readDoctorProbe({ ...env, version: "30.0.0" }, "probe-a", "/project", "Docker networks"),
    ).toBeUndefined();
  });

  it("keeps the verdicts of different probes side by side", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    writeDoctorProbe(env, "probe-b", "/project", {
      name: "x",
      didPass: false,
      message: "b failed",
    });
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")?.didPass).toBe(true);
    expect(readDoctorProbe(env, "probe-b", "/project", "x")?.didPass).toBe(false);
  });

  it("does not store skipped verdicts so the next run probes again", () => {
    writeDoctorProbe(env, "probe-a", "/project", {
      name: "Docker networks",
      didPass: true,
      isSkipped: true,
      message: "Could not test network creation",
    });
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")).toBeUndefined();
  });

  it("reads and writes nothing when disabled", () => {
    const off = { ...env, enabled: false };
    writeDoctorProbe(off, "probe-a", "/project", verdict);
    expect(existsSync(join(home, ".flisk", "doctor-probes.json"))).toBe(false);
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    expect(readDoctorProbe(off, "probe-a", "/project", "Docker networks")).toBeUndefined();
  });

  it("misses on a corrupt stamp file and recovers on the next write", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    writeFileSync(join(home, ".flisk", "doctor-probes.json"), "not json {");
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")).toBeUndefined();
    writeDoctorProbe(env, "probe-b", "/project", verdict);
    expect(readDoctorProbe(env, "probe-b", "/project", "Docker networks")?.didPass).toBe(true);
  });

  it("misses a stored verdict whose shape is wrong", () => {
    writeDoctorProbe(env, "probe-a", "/project", verdict);
    const stampPath = join(home, ".flisk", "doctor-probes.json");
    const raw = JSON.parse(readFileSync(stampPath, "utf-8"));
    raw.probes["probe-a"].result.didPass = "yes";
    writeFileSync(stampPath, JSON.stringify(raw));
    expect(readDoctorProbe(env, "probe-a", "/project", "Docker networks")).toBeUndefined();
  });
});

describe("clearDoctorProbes", () => {
  it("removes the stamp file so doctor --fix re-probes", () => {
    const home = mkdtempSync(join(tmpdir(), "flisk-probe-clear-"));
    try {
      const env: DoctorProbeEnvironment = {
        daemon: "|default",
        version: "v",
        enabled: true,
        home,
        now: Date.now,
      };
      writeDoctorProbe(env, "probe-a", "/p", { name: "x", didPass: true, message: "ok" });
      expect(readDoctorProbe(env, "probe-a", "/p", "x")).toBeDefined();
      clearDoctorProbes(home);
      expect(readDoctorProbe(env, "probe-a", "/p", "x")).toBeUndefined();
      clearDoctorProbes(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("checkDockerNetworkCapacity with a probe environment", () => {
  let home: string;
  let project: string;
  let env: DoctorProbeEnvironment;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flisk-probe-net-home-"));
    project = mkdtempSync(join(tmpdir(), "flisk-probe-net-proj-"));
    env = { daemon: "|default", version: "29.8.0", enabled: true, home, now: Date.now };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  const passingExec = (calls: string[]): ExecAsync =>
    (async (command: string) => {
      calls.push(command);
      return "";
    }) as ExecAsync;

  it("probes once and serves the verdict from the cache afterwards", async () => {
    const calls: string[] = [];
    const exec = passingExec(calls);

    const fresh = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });
    const cached = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });

    expect(fresh.didPass).toBe(true);
    expect(cached.didPass).toBe(true);
    expect(cached.message).toContain("Docker can create networks");
    expect(cached.message).toContain(CACHED_MARK);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^docker network create flisk_doctor_probe_/);
    expect(calls[1]).toMatch(/^docker network rm flisk_doctor_probe_/);
  });

  it("re-probes for a different project folder and when disabled", async () => {
    const calls: string[] = [];
    const exec = passingExec(calls);
    await checkDockerNetworkCapacity(exec, { probeEnvironment: env, projectRoot: project });

    const other = mkdtempSync(join(tmpdir(), "flisk-probe-net-other-"));
    try {
      await checkDockerNetworkCapacity(exec, { probeEnvironment: env, projectRoot: other });
      const off = await checkDockerNetworkCapacity(exec, {
        probeEnvironment: { ...env, enabled: false },
        projectRoot: project,
      });
      expect(off.message).not.toContain(CACHED_MARK);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    expect(calls).toHaveLength(6);
  });

  it("caches the exhausted-pool failure with its fix", async () => {
    const calls: string[] = [];
    const exec = (async (command: string) => {
      calls.push(command);
      throw Object.assign(new Error("failed"), {
        stderr: Buffer.from("all predefined address pools have been fully subnetted"),
      });
    }) as ExecAsync;

    const fresh = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });
    const cached = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });

    expect(fresh.didPass).toBe(false);
    expect(cached.didPass).toBe(false);
    expect(cached.fix).toContain("--scope=machine");
    expect(cached.message).toContain(CACHED_MARK);
    expect(calls).toHaveLength(1);
  });

  it("does not cache a skipped verdict", async () => {
    let runs = 0;
    const exec = (async () => {
      runs += 1;
      throw Object.assign(new Error("boom"), {
        stderr: Buffer.from("Cannot connect to the Docker daemon"),
      });
    }) as ExecAsync;

    const first = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });
    const second = await checkDockerNetworkCapacity(exec, {
      probeEnvironment: env,
      projectRoot: project,
    });
    expect(first.isSkipped).toBe(true);
    expect(second.isSkipped).toBe(true);
    expect(second.message).not.toContain(CACHED_MARK);
    expect(runs).toBe(2);
  });
});

describe("checkDockerFileSharing with a probe environment", () => {
  let home: string;
  let project: string;
  let env: DoctorProbeEnvironment;

  const passingRunner = (args: string[]) => {
    const cmd = args[args.length - 1] ?? "";
    const match = cmd.match(/\/flisk-probe\/(\.flisk-probe-[a-z0-9-]+)/);
    if (match?.[1]) writeFileSync(join(project, match[1]), "probe content\n");
    return Promise.resolve("");
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "flisk-probe-fs-home-"));
    project = mkdtempSync(join(tmpdir(), "flisk-probe-fs-proj-"));
    env = { daemon: "|default", version: "29.8.0", enabled: true, home, now: Date.now };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it("probes once and reuses the verdict for the same folder and daemon", async () => {
    let runs = 0;
    const runner = async (args: string[]) => {
      runs += 1;
      return passingRunner(args);
    };
    const options = { projectRoot: project, runner, hasDocker: true, probeEnvironment: env };

    const fresh = await checkDockerFileSharing(options);
    const cached = await checkDockerFileSharing(options);

    expect(fresh.didPass).toBe(true);
    expect(cached.didPass).toBe(true);
    expect(cached.message).toContain(CACHED_MARK);
    expect(runs).toBe(1);
  });

  it("re-probes a different project folder", async () => {
    let runs = 0;
    const runner = async (args: string[]) => {
      runs += 1;
      return passingRunner(args);
    };
    await checkDockerFileSharing({
      projectRoot: project,
      runner,
      hasDocker: true,
      probeEnvironment: env,
    });
    const other = mkdtempSync(join(tmpdir(), "flisk-probe-fs-other-"));
    try {
      await checkDockerFileSharing({
        projectRoot: other,
        runner,
        hasDocker: true,
        probeEnvironment: env,
      });
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    expect(runs).toBe(2);
  });

  it("accepts a promise for the probe environment like the doctor wiring passes", async () => {
    let runs = 0;
    const runner = async (args: string[]) => {
      runs += 1;
      return passingRunner(args);
    };
    const lazyEnv = Promise.resolve(env);
    const options = { projectRoot: project, runner, hasDocker: true, probeEnvironment: lazyEnv };
    await checkDockerFileSharing(options);
    const cached = await checkDockerFileSharing(options);
    expect(cached.message).toContain(CACHED_MARK);
    expect(runs).toBe(1);
  });

  it("caches a mount-denial failure and re-probes when disabled", async () => {
    let runs = 0;
    const runner = async () => {
      runs += 1;
      throw Object.assign(new Error("Command failed: docker run"), {
        code: 125,
        stderr: "Error response from daemon: Mounts denied: not shared from the host",
      });
    };
    const options = { projectRoot: project, runner, hasDocker: true, probeEnvironment: env };

    const fresh = await checkDockerFileSharing(options);
    const cached = await checkDockerFileSharing(options);
    expect(fresh.didPass).toBe(false);
    expect(cached.didPass).toBe(false);
    expect(cached.message).toContain(CACHED_MARK);
    expect(cached.fix).toContain("File sharing");
    expect(runs).toBe(1);

    const off = await checkDockerFileSharing({
      ...options,
      probeEnvironment: { ...env, enabled: false },
    });
    expect(off.didPass).toBe(false);
    expect(off.message).not.toContain(CACHED_MARK);
    expect(runs).toBe(2);
  });
});
