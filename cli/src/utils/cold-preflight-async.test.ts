// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({
  checkDockerRuntime: vi.fn(),
  checkTilt: vi.fn(),
  checkColimaAsync: vi.fn(),
  findOnPath: vi.fn(),
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
  fetchSharedDockerPs: vi.fn(),
  getHostPortPlan: vi.fn(),
  describeHostPortPlan: vi.fn(),
}));

vi.mock("../commands/doctor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/doctor.js")>()),
  checkDockerRuntime: probes.checkDockerRuntime,
  checkTilt: probes.checkTilt,
}));
vi.mock("./colima.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./colima.js")>()),
  checkColimaAsync: probes.checkColimaAsync,
}));
vi.mock("./which.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./which.js")>()),
  findOnPath: probes.findOnPath,
}));
vi.mock("./exec-async.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exec-async.js")>()),
  execAsync: probes.execAsync,
  execFileAsync: probes.execFileAsync,
}));
vi.mock("./host-command-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host-command-cache.js")>()),
  fetchSharedDockerPs: probes.fetchSharedDockerPs,
}));
vi.mock("./host-port-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host-port-config.js")>()),
  getHostPortPlan: probes.getHostPortPlan,
  describeHostPortPlan: probes.describeHostPortPlan,
}));
vi.mock("./paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./paths.js")>()),
  findProjectRoot: vi.fn(() => null),
}));

import { formatColdPreflight, runColdPreflight } from "./cold-preflight.js";
import { hasSharedDockerPsOutput, SHARED_DOCKER_PS } from "./host-command-cache.js";

const composeVersionCommand = "docker compose version --short";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  probes.checkColimaAsync.mockResolvedValue({ isColima: false, running: true });
  probes.checkDockerRuntime.mockResolvedValue({
    name: "Docker Runtime",
    didPass: true,
    message: "Docker daemon is running",
  });
  probes.checkTilt.mockResolvedValue({
    name: "Tilt",
    didPass: true,
    message: "Tilt v0.34.0 is available",
  });
  probes.findOnPath.mockImplementation((command: string) =>
    command === "bun" ? "/tools/bun" : null,
  );
  probes.execAsync.mockImplementation(async (command: string) => {
    if (command === composeVersionCommand) return "2.30.3\n";
    if (command === "docker version --format '{{json .Server}}'")
      return '{"Version":"27.0.3","Os":"linux"}\n';
    throw new Error(`unexpected exec: ${command}`);
  });
  probes.execFileAsync.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === "--version") return { stdout: "1.4.3\n", stderr: "" };
    throw new Error(`unexpected execFile: ${args.join(" ")}`);
  });
  probes.fetchSharedDockerPs.mockImplementation(async (cache: Map<string, unknown>) => {
    cache.set(
      JSON.stringify([SHARED_DOCKER_PS.shellCommand, "utf-8", SHARED_DOCKER_PS.timeoutMs]),
      { output: "api_1\timage\t8080/tcp\n" },
    );
  });
  probes.getHostPortPlan.mockResolvedValue({ ingressHttp: 80, ingressHttps: 443, postgres: 5432 });
  probes.describeHostPortPlan.mockReturnValue("HTTP 80, HTTPS 443, Postgres 5432");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("async cold preflight", () => {
  it("starts every independent probe before any of them finishes", async () => {
    const colima = deferred<{ isColima: boolean; running: boolean }>();
    probes.checkColimaAsync.mockReturnValue(colima.promise);

    const running = runColdPreflight({ scope: "runtime" });
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The slowest probe (Colima) is still pending; a sequential preflight would
    // not have reached any of the others yet.
    expect(probes.fetchSharedDockerPs).toHaveBeenCalledTimes(1);
    expect(probes.checkDockerRuntime).toHaveBeenCalledTimes(1);
    expect(probes.checkTilt).toHaveBeenCalledTimes(1);
    expect(probes.execAsync).toHaveBeenCalledWith(composeVersionCommand, 30_000);
    expect(probes.execFileAsync).toHaveBeenCalledWith(
      "/tools/bun",
      ["--version"],
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(probes.getHostPortPlan).toHaveBeenCalledTimes(1);

    colima.resolve({ isColima: false, running: true });
    await expect(running).resolves.toMatchObject({ ok: true, items: [] });
  });

  it("runs `docker compose version` once for both compose checks", async () => {
    await runColdPreflight({ scope: "runtime" });

    const composeCalls = probes.execAsync.mock.calls.filter(
      (call: unknown[]) => call[0] === composeVersionCommand,
    );
    expect(composeCalls).toHaveLength(1);
  });

  it("runs one shared docker ps and reuses it for Docker and the port plan", async () => {
    await runColdPreflight({ scope: "runtime" });

    expect(probes.fetchSharedDockerPs).toHaveBeenCalledTimes(1);
    const cache = probes.getHostPortPlan.mock.calls[0][1].commandCache;
    expect(probes.checkDockerRuntime).toHaveBeenCalledWith(cache);
    expect(hasSharedDockerPsOutput(cache)).toBe(true);
    const key = JSON.stringify([
      SHARED_DOCKER_PS.shellCommand,
      "utf-8",
      SHARED_DOCKER_PS.timeoutMs,
    ]);
    expect(cache.get(key)).toEqual({ output: "api_1\timage\t8080/tcp\n" });
  });

  it("keeps the failure text and item order unchanged", async () => {
    probes.checkDockerRuntime.mockResolvedValue({
      name: "Docker Runtime",
      didPass: false,
      message: "Docker daemon is not running",
    });
    probes.execAsync.mockImplementation(async (command: string) => {
      if (command === composeVersionCommand) throw new Error("compose missing");
      throw new Error(`unexpected exec: ${command}`);
    });
    probes.checkTilt.mockResolvedValue({
      name: "Tilt",
      didPass: false,
      message: "Tilt CLI not found",
      fix: "curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash\n  Verify: tilt version\n  Docs: https://docs.tilt.dev/install.html",
    });
    probes.execFileAsync.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === "--version") return { stdout: "1.0.0\n", stderr: "" };
      throw new Error(`unexpected execFile: ${args.join(" ")}`);
    });

    const result = await runColdPreflight({ scope: "runtime" });
    expect(result.items.map((item) => item.id)).toEqual(["docker", "compose", "tilt", "bun"]);
    expect(formatColdPreflight(result)).toBe(
      [
        "Cold start blocked. Bun 1.2+ must be installed on PATH.",
        "Prisma/NATS configuration is project-specific and generated after `flisk project`. Fix the machine checks below.",
        "FAIL docker  Docker daemon is not running",
        "FAIL compose Docker Compose plugin not found",
        "  Install Docker Compose: https://docs.docker.com/compose/install/",
        "FAIL tilt    Tilt CLI not found",
        "  curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash",
        "  Verify: tilt version",
        "  Docs: https://docs.tilt.dev/install.html",
        "FAIL bun     Bun 1.2+ not found on PATH",
        "  curl -fsSL https://bun.sh/install | bash",
      ].join("\n"),
    );
  });

  it("does not reuse any cache across preflight invocations", async () => {
    await runColdPreflight({ scope: "runtime" });
    await runColdPreflight({ scope: "runtime" });

    expect(probes.fetchSharedDockerPs).toHaveBeenCalledTimes(2);
    expect(
      probes.execAsync.mock.calls.filter((call: unknown[]) => call[0] === composeVersionCommand),
    ).toHaveLength(2);
  });
});
