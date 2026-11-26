// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dockerCalls: string[] = [];
let dockerPsOutput = "";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn((file: string, args: string[]) => {
    dockerCalls.push(`${file} ${args.join(" ")}`);
    return file === "docker" ? dockerPsOutput : "";
  }),
}));

vi.mock("../which.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../which.js")>()),
  // The shared docker ps resolves the binary before it runs, and the resolution depends on the host's PATH
  // (/usr/bin/docker on Linux, nothing where Docker is absent). Resolving to the bare name keeps the recorded
  // call identical on every host, so the count assertions below do not flake with the runner's environment.
  findOnPath: vi.fn((command: string) => command),
}));

const asyncDockerCalls: string[] = [];
const execFileCalls: string[] = [];
let execFileOutput = "";
let execFileError: unknown;

vi.mock("../exec-async.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../exec-async.js")>()),
  execAsync: vi.fn(async (command: string) => {
    asyncDockerCalls.push(command);
    return "";
  }),
  execFileAsync: vi.fn(async (file: string, args: string[]) => {
    execFileCalls.push(`${file} ${args.join(" ")}`);
    if (execFileError) throw execFileError;
    return { stdout: execFileOutput, stderr: "" };
  }),
}));

import { checkDockerRuntime } from "../../commands/doctor.js";
import { checkIngressPorts, checkPrivateNpmRegistry } from "../doctor-runtime.js";
import {
  createHostCommandCache,
  fetchSharedDockerPs,
  hasSharedDockerPsOutput,
} from "../host-command-cache.js";
import { getHostPortPlan, readSharedDockerPs, toNamePortsLines } from "../host-port-config.js";

describe("shared docker ps", () => {
  let projectRoot = "";

  function verdaccioProject(): string {
    const root = mkdtempSync(join(tmpdir(), "flisk-shared-docker-ps-verdaccio-"));
    writeFileSync(join(root, ".npmrc"), "registry=http://localhost:4873\n");
    return root;
  }

  afterEach(() => {
    dockerCalls.length = 0;
    asyncDockerCalls.length = 0;
    execFileCalls.length = 0;
    dockerPsOutput = "";
    execFileOutput = "";
    execFileError = undefined;
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it("calls docker ps once when the port plan and the ingress check run together", async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "flisk-shared-docker-ps-"));
    const commandCache = createHostCommandCache();
    const exec = ((command: string) => {
      dockerCalls.push(command);
      return "";
    }) as never;

    await getHostPortPlan(projectRoot, { isPortFree: async () => true, commandCache });
    checkIngressPorts(exec, "flisk-project", undefined, { commandCache });

    expect(dockerCalls.filter((call) => call.includes("docker"))).toHaveLength(1);
  });

  it("calls docker ps once when the port plan, the ingress check and the Verdaccio check share a cache", async () => {
    projectRoot = verdaccioProject();
    dockerPsOutput = "flisk_shop_verdaccio\tverdaccio/verdaccio\t0.0.0.0:4873->4873/tcp";
    const commandCache = createHostCommandCache();
    const exec = ((command: string) => {
      dockerCalls.push(command);
      return "";
    }) as never;

    await getHostPortPlan(projectRoot, { isPortFree: async () => true, commandCache });
    checkIngressPorts(exec, "flisk-project", undefined, { commandCache });
    const registry = checkPrivateNpmRegistry(
      exec,
      projectRoot,
      "http://localhost:4873",
      true,
      commandCache,
    );

    expect(dockerCalls.filter((call) => call.includes("docker"))).toHaveLength(1);
    expect(registry.message).toContain("Verdaccio container is running");
  });

  it("asks the supplied executor, not the host, when the Verdaccio check has an empty cache", () => {
    projectRoot = verdaccioProject();
    const commandCache = createHostCommandCache();
    const exec = ((command: string) => {
      dockerCalls.push(command);
      return "flisk_shop_verdaccio\tverdaccio/verdaccio\t0.0.0.0:4873->4873/tcp";
    }) as never;

    const registry = checkPrivateNpmRegistry(
      exec,
      projectRoot,
      "http://localhost:4873",
      true,
      commandCache,
    );

    expect(dockerCalls.filter((call) => call.includes("docker"))).toHaveLength(1);
    expect(registry.message).toContain("Verdaccio container is running");
  });

  it("still runs the old docker ps --format {{.Names}} when the Verdaccio check has no cache", () => {
    projectRoot = verdaccioProject();
    const exec = ((command: string) => {
      dockerCalls.push(command);
      return "flisk_shop_verdaccio\n";
    }) as never;

    const registry = checkPrivateNpmRegistry(exec, projectRoot, "http://localhost:4873");

    expect(dockerCalls).toContain("docker ps --format '{{.Names}}'");
    expect(registry.message).toContain("Verdaccio container is running");
  });

  it("lists containers once for the port plan and the runtime check together", async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "flisk-shared-docker-ps-runtime-"));
    const commandCache = createHostCommandCache();
    expect(hasSharedDockerPsOutput(commandCache)).toBe(false);

    await getHostPortPlan(projectRoot, { isPortFree: async () => true, commandCache });
    const runtime = await checkDockerRuntime(commandCache);

    expect(hasSharedDockerPsOutput(commandCache)).toBe(true);
    expect(runtime.didPass).toBe(true);
    expect(dockerCalls.filter((call) => call.startsWith("docker"))).toHaveLength(1);
    expect(asyncDockerCalls.filter((call) => call.includes("docker ps"))).toHaveLength(0);
  });

  it("still runs its own docker ps in the runtime check when the port plan did not list containers", async () => {
    const runtime = await checkDockerRuntime(createHostCommandCache());

    expect(runtime.didPass).toBe(true);
    expect(asyncDockerCalls.filter((call) => call.includes("docker ps"))).toHaveLength(1);
  });

  it("runs the shared docker ps asynchronously and publishes it for later readers", async () => {
    execFileOutput = "web\tnginx\t0.0.0.0:80->80/tcp\n";
    const commandCache = createHostCommandCache();

    await fetchSharedDockerPs(commandCache);

    expect(execFileCalls).toEqual(["docker ps --format {{.Names}}\\t{{.Image}}\\t{{.Ports}}"]);
    expect(hasSharedDockerPsOutput(commandCache)).toBe(true);
    // The cache is already populated: reading it launches no second probe.
    expect(readSharedDockerPs(commandCache)).toBe(execFileOutput);
    expect(execFileCalls).toHaveLength(1);
    expect(dockerCalls).toHaveLength(0);
  });

  it("caches a failed async docker ps without treating the daemon as up", async () => {
    const failure = new Error("daemon down");
    execFileError = failure;
    const commandCache = createHostCommandCache();

    await expect(fetchSharedDockerPs(commandCache)).rejects.toBe(failure);

    expect(hasSharedDockerPsOutput(commandCache)).toBe(false);
    expect(() => readSharedDockerPs(commandCache)).toThrow(failure);
    expect(execFileCalls).toHaveLength(1);
    expect(dockerCalls).toHaveLength(0);
  });

  it("converts tab-separated docker ps lines to name|ports lines", () => {
    const tabbed = "flisk_shop_traefik\ttraefik:v3\t0.0.0.0:80->80/tcp\nweb\tnginx\t";
    expect(toNamePortsLines(tabbed)).toBe("flisk_shop_traefik|0.0.0.0:80->80/tcp\nweb|");
  });
});
