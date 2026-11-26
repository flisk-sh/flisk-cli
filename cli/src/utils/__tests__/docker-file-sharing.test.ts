// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDockerFileSharing,
  DOCKER_FILE_SHARING_CHECK,
  formatDockerFileSharingFix,
  isDockerProbeTimeout,
  runDockerProbe,
} from "../docker-file-sharing.js";

describe("checkDockerFileSharing", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "flisk-docker-share-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it("passes when the folder is shared and removes the probe file", async () => {
    let capturedArgs: string[] = [];
    const fakeRunner = async (args: string[]) => {
      capturedArgs = args;
      // Extract probe filename from the command argument
      const cmd = args[args.length - 1] ?? "";
      const match = cmd.match(/\/flisk-probe\/(\.flisk-probe-[a-z0-9-]+)/);
      if (match?.[1]) {
        // Simulate container writing to host through bind mount
        writeFileSync(join(tempDir, match[1]), "probe content\n");
      }
      return "";
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.name).toBe(DOCKER_FILE_SHARING_CHECK);
    expect(result.didPass).toBe(true);
    expect(result.message).toContain(tempDir);

    // Verify container removal flag (--rm) was used
    expect(capturedArgs).toContain("--rm");
    expect(capturedArgs).toContain("-v");
    expect(capturedArgs).toContain(`${tempDir}:/flisk-probe`);

    // Verify probe file was removed from the host
    const files = existsSync(tempDir);
    expect(files).toBe(true);
    // The probe file inside tempDir should no longer exist
    const probeFiles = (args: string[]) => {
      const match = (args[args.length - 1] ?? "").match(
        /\/flisk-probe\/(\.flisk-probe-[a-z0-9-]+)/,
      );
      return match?.[1] ? existsSync(join(tempDir, match[1])) : false;
    };
    expect(probeFiles(capturedArgs)).toBe(false);
  });

  it("fails with fix when the folder is not shared into the VM", async () => {
    // Fake runner runs successfully inside VM, but does NOT create file on host
    const fakeRunner = async () => "";

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.name).toBe(DOCKER_FILE_SHARING_CHECK);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain(tempDir);
    expect(result.message).toContain("bind mounts silently stay inside the VM");

    // Fix must name the folder and how to share it
    expect(result.fix).toContain(tempDir);
    expect(result.fix).toContain("Docker Desktop: Settings → Resources → File sharing");
    expect(result.fix).toContain("Colima: start with --mount");
    expect(result.fix).toContain("Remote engine");
  });

  it("fails with fix when docker run rejects the mount", async () => {
    const fakeRunner = async () => {
      throw new Error("docker: Error response from daemon: Mounts denied.");
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.name).toBe(DOCKER_FILE_SHARING_CHECK);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker cannot access the project folder");
    expect(result.fix).toContain(tempDir);
    expect(result.fix).toContain("File sharing");
  });

  it("does not blame file sharing when the probe container could not run at all", async () => {
    // A WSL2 user saw "Docker cannot access the project folder" while their bind mounts worked: the probe image pull failed.
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run --rm alpine"), {
        stderr:
          "Unable to find image 'alpine:latest' locally\nError response from daemon: Get \"https://registry-1.docker.io/v2/\": net/http: TLS handshake timeout",
      });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("file sharing was not tested");
    expect(result.message).toContain("Unable to find image 'alpine:latest' locally");
    // The cause on the next line is kept, not only the first line.
    expect(result.message).toContain("TLS handshake timeout");
    expect(result.fix).toBeUndefined();
  });

  it("does not blame file sharing for a daemon permission error before the probe starts", async () => {
    // docker run exits 125 when the daemon fails it: no container started, so the mount was never tried.
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run"), {
        code: 125,
        stderr: "permission denied while trying to connect to the Docker daemon socket",
      });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("permission denied while trying to connect");
  });

  it.each([
    [
      "Docker 29 with a missing daemon socket",
      1,
      "failed to connect to the docker API at unix:///Users/sunny/.docker/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/sunny/.docker/run/docker.sock: connect: no such file or directory",
    ],
    [
      "a stopped Colima engine",
      1,
      "failed to connect to the docker API at unix:///Users/sunny/.colima/default/docker.sock; check if the path is correct and if the daemon is running: dial unix /Users/sunny/.colima/default/docker.sock: connect: no such file or directory",
    ],
    [
      "a refused remote daemon",
      1,
      "Cannot connect to the Docker daemon at tcp://192.168.1.10:2375. Is the docker daemon running?: dial tcp 192.168.1.10:2375: connect: connection refused",
    ],
  ])("skips file sharing when %s cannot be reached", async (_case, code, stderr) => {
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run"), { code, stderr });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("Docker daemon is unreachable");
    expect(result.message).toContain("file sharing was not tested");
    expect(result.message).toContain(stderr);
    expect(result.fix).toBeUndefined();
  });

  it("keeps reporting a genuine mount denial with the file sharing fix", async () => {
    const stderr =
      "Error response from daemon: Mounts denied: The path /Users/sunny/project is not shared from the host and is not known to Docker.";
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run"), { code: 1, stderr });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.didPass).toBe(false);
    expect(result.isSkipped).toBeUndefined();
    expect(result.message).toContain("Docker cannot access the project folder");
    expect(result.fix).toContain("File sharing");
    expect(result.fix).toContain("Colima: start with --mount");
  });

  it.each([
    [
      "a mount denial that echoes the path",
      125,
      "Error response from daemon: Mounts denied: The path /Users/sunny/connection refused/project is not shared from the host and is not known to Docker.",
    ],
    [
      "a started probe whose write failed",
      2,
      "sh: can't create /flisk-probe/x: Read-only file system",
    ],
  ])(
    "keeps failing when the project path reads like a connection failure (%s)",
    async (_case, code, stderr) => {
      // Regression: execFile's message echoes the command line and a mount denial echoes the project path, so a path
      // segment such as "connection refused" reaches the detail text. That path text must not read as the daemon being
      // unreachable (a skip) or as the probe never having started.
      const fakeRunner = async () => {
        throw Object.assign(
          new Error(
            "Command failed: docker run --rm -v /Users/sunny/connection refused/project:/flisk-probe alpine sh -c echo",
          ),
          { code, stderr },
        );
      };

      const result = await checkDockerFileSharing({
        projectRoot: tempDir,
        runner: fakeRunner,
        hasDocker: true,
      });

      expect(result.didPass).toBe(false);
      expect(result.isSkipped).toBeUndefined();
      expect(result.message).toContain("Docker cannot access the project folder");
      expect(result.fix).toContain("File sharing");
    },
  );

  it("fails when the probe started but could not write into the mount", async () => {
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run"), {
        code: 2,
        stderr: "sh: can't create /flisk-probe/x: Read-only file system",
      });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Docker cannot access the project folder");
    expect(result.fix).toContain("File sharing");
  });

  it.each([
    [
      "an unauthorized image pull",
      125,
      "Error response from daemon: pull access denied for alpine, repository does not exist or may require 'docker login': denied: requested access to the resource is denied",
      true,
    ],
    [
      "the daemon being unreachable",
      1,
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      true,
    ],
    [
      "Operation not permitted inside the started probe",
      1,
      "sh: can't create /flisk-probe/x: Operation not permitted",
      false,
    ],
    [
      "permission denied inside the started probe",
      2,
      "sh: can't create /flisk-probe/x: Permission denied",
      false,
    ],
    [
      "a mount Docker refuses before start",
      125,
      "Error response from daemon: Mounts denied: The path /p is not shared from the host",
      false,
    ],
  ])("classifies %s (exit %i)", async (_case, code, stderr, skipped) => {
    // Exit 1 for an unreachable daemon comes from the docker CLI itself, not from a container, so it is told apart by
    // Docker's own text; any other exit 1-124 is the probe's `sh` failing to write into the mount.
    const fakeRunner = async () => {
      throw Object.assign(new Error("Command failed: docker run"), { code, stderr });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(Boolean(result.isSkipped)).toBe(skipped);
    expect(result.didPass).toBe(skipped);
  });

  it("skips when Docker CLI is not installed", async () => {
    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      hasDocker: false,
    });

    expect(result.name).toBe(DOCKER_FILE_SHARING_CHECK);
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
  });

  it.each([
    ["a probe killed by its deadline", { killed: true, signal: "SIGTERM" }],
    ["a runner-level exec timeout", { code: "ETIMEDOUT" }],
    [
      "a runDockerProbe deadline rejection",
      { fliskDockerProbeTimeout: true, message: "docker run timed out after 15000 ms" },
    ],
  ])("fails with a named mount-probe timeout when %s stalls", async (_case, fields) => {
    // A wedged Docker Desktop file share leaves `docker run` hanging; the deadline turns that into
    // an actionable finding instead of doctor sitting at "Checking environment..." for minutes.
    const fakeRunner = async () => {
      throw Object.assign(new Error("docker run timed out"), fields);
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
    });

    expect(result.name).toBe(DOCKER_FILE_SHARING_CHECK);
    expect(result.didPass).toBe(false);
    expect(result.isSkipped).toBeUndefined();
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("mount probe timed out after 15 s");
    expect(result.message).toContain(tempDir);
    expect(result.fix).toContain("restarting Docker Desktop usually fixes it");
  });

  it("names the configured timeout in the failure", async () => {
    const fakeRunner = async () => {
      throw Object.assign(new Error("docker run timed out"), { killed: true });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: fakeRunner,
      hasDocker: true,
      timeoutMs: 5_000,
    });

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("timed out after 5 s");
  });

  it("warns instead of failing when the probe timed out but its write reached the host", async () => {
    // The bind mount worked (the file exists); only the container hung on exit. The probe file name
    // is random per run, so the fake writes through the args the runner saw.
    const capturingRunner = async (args: string[]) => {
      const match = (args[args.length - 1] ?? "").match(
        /\/flisk-probe\/(\.flisk-probe-[a-z0-9-]+)/,
      );
      if (match?.[1]) writeFileSync(join(tempDir, match[1]), "1");
      throw Object.assign(new Error("docker run timed out"), { killed: true });
    };

    const result = await checkDockerFileSharing({
      projectRoot: tempDir,
      runner: capturingRunner,
      hasDocker: true,
    });

    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("did not exit within 15 s");
  });
});

describe("formatDockerFileSharingFix", () => {
  it("formats instructions for Docker Desktop, Colima, and remote engines", () => {
    const fix = formatDockerFileSharingFix("/Users/sunny/my-project");
    expect(fix).toContain("/Users/sunny/my-project");
    expect(fix).toContain("Docker Desktop: Settings → Resources → File sharing");
    expect(fix).toContain(
      "Colima: start with --mount (e.g. colima start --mount /Users/sunny/my-project)",
    );
    expect(fix).toContain("Remote engine: run Flisk directly on that host");
  });
});

describe("runDockerProbe", () => {
  const listenerCounts = () => ({
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
  });

  /** A fake child that never exits, like `docker run` against a wedged daemon. */
  const hangingExecFile = () => {
    const child = { kill: vi.fn() };
    const execFileImpl = vi.fn(() => child);
    return { child, execFileImpl };
  };

  /** A fake child whose `docker run` finishes with the given callback arguments. */
  const finishingExecFile = (error: Error | null, stdout = "", stderr = "") => {
    const child = { kill: vi.fn() };
    const execFileImpl = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        queueMicrotask(() => callback(error, stdout, stderr));
        return child;
      },
    );
    return { child, execFileImpl };
  };

  it("resolves with stdout when the probe exits cleanly", async () => {
    const before = listenerCounts();
    const { execFileImpl } = finishingExecFile(null, "probe-ok");

    await expect(
      runDockerProbe(["run", "--rm"], { execFileImpl: execFileImpl as never }),
    ).resolves.toBe("probe-ok");
    expect(listenerCounts()).toEqual(before);
  });

  it("rejects with the docker error and keeps stderr attached", async () => {
    const before = listenerCounts();
    const failure = Object.assign(new Error("Command failed: docker run"), {
      code: 125,
    });
    const { execFileImpl } = finishingExecFile(failure, "", "Mounts denied");

    const rejection = runDockerProbe(["run"], { execFileImpl: execFileImpl as never });
    await expect(rejection).rejects.toThrow("Command failed: docker run");
    await expect(rejection).rejects.toMatchObject({ code: 125, stderr: "Mounts denied" });
    expect(listenerCounts()).toEqual(before);
  });

  it("rejects a sync spawn failure without leaking signal listeners", async () => {
    const before = listenerCounts();
    const execFileImpl = vi.fn(() => {
      throw new Error("spawn docker ENOENT");
    });

    await expect(runDockerProbe(["run"], { execFileImpl: execFileImpl as never })).rejects.toThrow(
      "spawn docker ENOENT",
    );
    expect(listenerCounts()).toEqual(before);
  });

  it("SIGTERMs then SIGKILLs a hung probe and rejects a marked timeout error", async () => {
    vi.useFakeTimers();
    try {
      const before = listenerCounts();
      const { child, execFileImpl } = hangingExecFile();
      const probe = runDockerProbe(["run", "--rm"], {
        timeoutMs: 15_000,
        execFileImpl: execFileImpl as never,
      });
      const assertion = expect(probe).rejects.toThrow("timed out");

      // Nothing before the deadline; SIGTERM at it; SIGKILL after the kill grace.
      await vi.advanceTimersByTimeAsync(14_999);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      await assertion;
      await expect(probe).rejects.toSatisfy(isDockerProbeTimeout);
      expect(listenerCounts()).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors a shorter configured deadline", async () => {
    vi.useFakeTimers();
    try {
      const { child, execFileImpl } = hangingExecFile();
      const probe = runDockerProbe(["run"], {
        timeoutMs: 200,
        execFileImpl: execFileImpl as never,
      });
      const assertion = expect(probe).rejects.toSatisfy(isDockerProbeTimeout);
      await vi.advanceTimersByTimeAsync(200);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])("kills the probe child on doctor's %s before exiting %i", async (signal, code) => {
    vi.useFakeTimers();
    const before = listenerCounts();
    const { child, execFileImpl } = hangingExecFile();
    const onSignal = vi.fn();
    const onceSpy = vi.spyOn(process, "once");
    try {
      const probe = runDockerProbe(["run", "--rm"], {
        timeoutMs: 60_000,
        execFileImpl: execFileImpl as never,
        onSignal,
      });
      const handler = onceSpy.mock.calls.find(([event]) => event === signal)?.[1];
      expect(handler).toBeTypeOf("function");

      (handler as () => void)();
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(onSignal).toHaveBeenCalledWith(signal, code);

      // The default handler would exit the process here; the injected one lets the probe run out.
      const assertion = expect(probe).rejects.toSatisfy(isDockerProbeTimeout);
      await vi.advanceTimersByTimeAsync(61_000);
      await assertion;
      // Both once-registered listeners are gone once the probe settles.
      expect(listenerCounts()).toEqual(before);
    } finally {
      onceSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("removes both signal listeners once the probe settles", async () => {
    const before = listenerCounts();
    const { execFileImpl } = finishingExecFile(null, "");
    await runDockerProbe(["run"], { execFileImpl: execFileImpl as never });
    expect(listenerCounts()).toEqual(before);
  });
});

describe("isDockerProbeTimeout", () => {
  it("recognizes only deadline rejections", () => {
    expect(
      isDockerProbeTimeout(Object.assign(new Error("x"), { fliskDockerProbeTimeout: true })),
    ).toBe(true);
    expect(isDockerProbeTimeout(new Error("x"))).toBe(false);
    expect(isDockerProbeTimeout({ killed: true })).toBe(false);
    expect(isDockerProbeTimeout(null)).toBe(false);
    expect(isDockerProbeTimeout(undefined)).toBe(false);
  });
});
