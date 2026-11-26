// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { ChildProcess } from "node:child_process";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureExit, parseEnvelope } from "../../test-support/index.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";
import * as hostPortPlan from "../../utils/host-port-plan.js";
import * as portAssignment from "../../utils/port-assignment.js";
import { checkServiceStatus, determineDefaultDomain, networksCommand } from "../networks.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(),
    spawn: vi.fn(),
  };
});

function expectNoCurlSpawn(): void {
  const commands = vi.mocked(childProcess.spawn).mock.calls.map(([command]) => String(command));
  expect(commands.some((command) => /curl(?:\.exe)?$/i.test(command))).toBe(false);
}

function captureLogLines(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

function mockDockerDown(): void {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(childProcess.execFileSync).mockImplementation(() => {
    throw new Error("Docker daemon not running");
  });
}

function createMockChildProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: Error;
}): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new EventEmitter() as ChildProcess["stdout"];
  child.stderr = new EventEmitter() as ChildProcess["stderr"];

  queueMicrotask(() => {
    if (options.error) {
      child.emit("error", options.error);
      return;
    }
    if (options.stdout) {
      child.stdout?.emit("data", Buffer.from(options.stdout));
    }
    if (options.stderr) {
      child.stderr?.emit("data", Buffer.from(options.stderr));
    }
    child.emit("close", options.exitCode ?? 0);
  });

  return child;
}

const originalCwd = process.cwd();

describe("networksCommand and helpers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "flisk-networks-test-"));
    process.chdir(tempDir);
    networksCommand.setOptionValue("stack", undefined);
    networksCommand.setOptionValue("json", false);
    networksCommand.setOptionValue("jsonLegacy", false);
    networksCommand.setOptionValue("raw", false);
    vi.spyOn(hostPortPlan, "createHostPortPlan").mockResolvedValue({
      ingressHttp: 80,
      ingressHttps: 443,
      postgres: 5432,
      requested: { ingressHttp: 80, ingressHttps: 443, postgres: 5432 },
      explicit: { ingressHttp: false, ingressHttps: false, postgres: false },
      reason: { ingressHttp: "default", ingressHttps: "default", postgres: "default" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    clearDiscoveryCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function setupProject(
    projectName = "acme",
    resources: Array<{
      name: string;
      appType: string;
      stack?: string;
      port?: number;
      basePath?: string;
      apiPath?: string;
      webUi?: boolean;
      command?: string;
      dockerfile?: string;
      /** Override the conventional `services/<stack>/<name>` folder, e.g. `api` for a `flisk create` layout. */
      dir?: string;
    }> = [],
  ): void {
    mkdirSync(join(tempDir, ".flisk"), { recursive: true });
    writeFileSync(
      join(tempDir, ".flisk", "project.json"),
      JSON.stringify({
        version: "1.0.0",
        project: { name: projectName, version: "1.0.0" },
        phases: {
          pre_alpha: { enabledStacks: [] },
          alpha: { enabledStacks: [] },
          beta: { enabledStacks: [] },
          out_of_scope: { enabledStacks: [] },
        },
        optional_infra: {
          monitoring: false,
          elk: false,
          debezium: false,
          golden_image: false,
          verdaccio: false,
        },
        discovery: { paths: ["services/**"] },
      }),
    );

    for (const r of resources) {
      const group = r.stack ?? "default";
      const resourceDir = r.dir ? join(tempDir, r.dir) : join(tempDir, "services", group, r.name);
      mkdirSync(resourceDir, { recursive: true });
      writeFileSync(
        join(resourceDir, "service.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            appName: r.name,
            appType: r.appType,
            runtime: "bun",
            ...(r.stack ? { stack: r.stack } : {}),
            ...(r.port ? { port: r.port } : {}),
            ...(r.basePath ? { basePath: r.basePath } : {}),
            ...(r.apiPath ? { apiPath: r.apiPath } : {}),
            ...(r.webUi !== undefined ? { webUi: r.webUi } : {}),
            ...(r.command ? { command: r.command } : {}),
            ...(r.dockerfile ? { dockerfile: r.dockerfile } : {}),
          },
          null,
          2,
        ),
      );
    }
    clearDiscoveryCache();
  }

  /** A live `.flisk/native/run.json`: the test process's own pid stands in for the supervisor and each service. */
  function writeNativeRun(
    services: Record<
      string,
      { pid?: number; port?: number; url?: string; ready?: boolean; failed?: boolean }
    >,
  ): void {
    const dir = join(tempDir, ".flisk", "native");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), services }),
    );
  }

  describe("determineDefaultDomain", () => {
    it("returns <project>.localhost when project has a custom name", () => {
      setupProject("shopfront");
      expect(determineDefaultDomain()).toBe("shopfront.localhost");
    });

    it("names a linked worktree in the domain reported by flisk networks (#4697)", () => {
      setupProject("acme");
      writeFileSync(join(tempDir, ".git"), "gitdir: /elsewhere/.git/worktrees/feature-login\n");
      vi.stubEnv("FLISK_CHECKOUT_NAME", "Feature.Login");
      expect(determineDefaultDomain(false, undefined, tempDir)).toBe(
        "feature-login.flisk-project.localhost",
      );
    });

    it("FLISK_CHECKOUT_HOST=always names a main checkout too (#4697)", () => {
      setupProject("acme");
      vi.stubEnv("FLISK_CHECKOUT_HOST", "always");
      vi.stubEnv("FLISK_CHECKOUT_NAME", "main-copy");
      expect(determineDefaultDomain(false, undefined, tempDir)).toBe(
        "main-copy.flisk-project.localhost",
      );
    });

    it("uses the checkout name override for the local hostname (#4046)", () => {
      setupProject("shopfront");
      vi.stubEnv("FLISK_PROJECT_NAME", "Shopfront-Agent-Two");
      expect(determineDefaultDomain()).toBe("shopfront-agent-two.localhost");
    });

    it("scans Traefik Docker labels and prefers shortest project domain when project name is default", () => {
      setupProject("flisk-project");
      vi.mocked(childProcess.execFileSync).mockReturnValue(
        [
          "traefik.http.routers.fe.rule=Host(`myapp-api-frontend.localhost`)",
          "traefik.http.routers.app.rule=Host(`app.acme.localhost`) || Host(`acme.localhost`)",
        ].join("\n"),
      );

      expect(determineDefaultDomain()).toBe("acme.localhost");
    });

    it("never takes a dashboard host as the project domain", () => {
      setupProject("flisk-project");
      vi.mocked(childProcess.execFileSync).mockReturnValue(
        "traefik.http.routers.d.rule=Host(`dash.acme.localhost`) || Host(`app.acme.localhost`)",
      );

      expect(determineDefaultDomain()).toBe("app.acme.localhost");
    });

    it("extracts matching common project domain when only service-specific and common domains exist", () => {
      setupProject("flisk-project");
      vi.mocked(childProcess.execFileSync).mockReturnValue(
        "traefik.http.routers.fe.rule=Host(`myapp-api-frontend.localhost`)\ntraefik.http.routers. api.rule=Host(`myapp-core-backend.localhost`)",
      );

      expect(determineDefaultDomain()).toBe("localhost");
    });

    it("warns and falls back to localhost when the Docker command fails", () => {
      setupProject("flisk-project");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(childProcess.execFileSync).mockImplementation(() => {
        throw new Error("Cannot connect to the Docker daemon");
      });

      expect(determineDefaultDomain()).toBe("localhost");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not scan Traefik domains (Docker unavailable)"),
      );
    });
  });

  describe("checkServiceStatus", () => {
    it("returns stopped for non-HTTP URLs without fetching or spawning curl", async () => {
      expect(await checkServiceStatus("orders-api", 4000, "ftp://acme.localhost/api")).toBe(
        "stopped",
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it("reports a reachable URL as running with fetch, with no curl on PATH", async () => {
      vi.stubEnv("PATH", "");
      vi.mocked(childProcess.spawn).mockImplementation(() => {
        throw new Error("curl is not on PATH");
      });
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

      expect(await checkServiceStatus("web", 3000, "http://app.acme.localhost/")).toBe("running");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://app.acme.localhost/",
        expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
      );
      expectNoCurlSpawn();
    });

    it("reports an unreachable URL as stopped with no curl on PATH", async () => {
      vi.stubEnv("PATH", "");
      vi.mocked(childProcess.spawn).mockImplementation(() => {
        throw new Error("curl is not on PATH");
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("fetch failed"));

      expect(await checkServiceStatus("web", undefined, "http://app.acme.localhost/")).toBe(
        "stopped",
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("HTTP check failed"));
      expectNoCurlSpawn();
    });

    it("falls back to the port check when the HTTP check cannot run", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("fetch failed"));
      vi.spyOn(portAssignment, "checkPortStatus").mockResolvedValueOnce("running");

      expect(await checkServiceStatus("web", 3000, "http://app.acme.localhost/")).toBe("running");
      expect(portAssignment.checkPortStatus).toHaveBeenCalledWith(3000);
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it("returns running on 2xx/3xx HTTP status and stopped on 4xx/5xx", async () => {
      const statuses = [
        [200, "running"],
        [302, "running"],
        [401, "running"],
        [403, "running"],
        [404, "stopped"],
        [502, "stopped"],
      ] as const;
      for (const [status, expected] of statuses) {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(null, { status }));
        expect(await checkServiceStatus("web", 3000, "http://app.acme.localhost/")).toBe(expected);
      }
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it("falls back to port probe and Docker container check, handling Docker command failure", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      vi.spyOn(portAssignment, "checkPortStatus").mockResolvedValueOnce("running");
      expect(await checkServiceStatus("orders-api", 4000)).toBe("running");

      vi.spyOn(portAssignment, "checkPortStatus").mockResolvedValueOnce("unknown");
      vi.mocked(childProcess.spawn).mockImplementationOnce(() =>
        createMockChildProcess({ stdout: "flisk-orders-api\n" }),
      );
      expect(await checkServiceStatus("orders-api", 4000)).toBe("running");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Could not check port 4000"));

      vi.spyOn(portAssignment, "checkPortStatus").mockResolvedValueOnce("stopped");
      vi.mocked(childProcess.spawn).mockImplementationOnce(() =>
        createMockChildProcess({ error: new Error("docker ENOENT") }),
      );
      expect(await checkServiceStatus("orders-api", 4000)).toBe("stopped");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not check Docker for orders-api"),
      );
    });
  });

  describe("networksCommand action", () => {
    it("prints empty message and exits 0 when there are no routable networks", async () => {
      setupProject("acme", [{ name: "worker", appType: "worker", stack: "core" }]);
      const lines = captureLogLines();
      const { exit } = captureExit();

      await expect(
        networksCommand.parseAsync(["node", "flisk"], { from: "node" }),
      ).rejects.toThrow();

      expect(exit).toHaveBeenCalledWith(0);
      expect(stripVTControlCharacters(lines.join("\n"))).toContain("No routable services found");
    });

    it("prints stack-specific empty message when a stack has no routable services", async () => {
      setupProject("acme", [{ name: "worker", appType: "worker", stack: "jobs" }]);
      const lines = captureLogLines();
      const { exit } = captureExit();

      await expect(
        networksCommand.parseAsync(["node", "flisk", "--stack", "jobs"], { from: "node" }),
      ).rejects.toThrow();

      expect(exit).toHaveBeenCalledWith(0);
      expect(stripVTControlCharacters(lines.join("\n"))).toContain(
        'No routable services found in stack "jobs"',
      );
    });

    it("lists a proxied bring-your-own service at its /api/<name> URL", async () => {
      setupProject("flisk-project", [{ name: "vote", appType: "bring-your-own", port: 80 }]);
      mockDockerDown();

      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).not.toContain("No routable services found");
      // With the trailing slash: the page's relative links only resolve under the prefix with it.
      expect(output).toMatch(/http:\/\/api\.localhost:80\/api\/vote\/(\s|$)/);
    });

    it("lists a proxied bring-your-own service at its apiPath", async () => {
      setupProject("flisk-project", [
        { name: "vote", appType: "bring-your-own", port: 80, apiPath: "/ballots" },
      ]);
      mockDockerDown();

      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toMatch(/http:\/\/api\.localhost:80\/ballots\/(\s|$)/);
      expect(output).not.toContain("/api/vote");
    });
    it("lists a webUi bring-your-own service at its own host", async () => {
      setupProject("flisk-project", [
        { name: "dashboard", appType: "bring-your-own", port: 8080, webUi: true },
      ]);
      mockDockerDown();

      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toMatch(/http:\/\/dashboard\.localhost:80(\s|$)/);
    });

    it("follows FLISK_SERVICE_BASE_URL like flisk up", async () => {
      setupProject("flisk-project", [{ name: "vote", appType: "bring-your-own", port: 80 }]);
      vi.stubEnv("FLISK_SERVICE_BASE_URL", "https://demo.test:9000");
      mockDockerDown();
      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toMatch(/https:\/\/api\.demo\.test:9000\/api\/vote\/(\s|$)/);
    });

    it("follows FLISK_PUBLIC_HOST like flisk up", async () => {
      setupProject("flisk-project", [{ name: "vote", appType: "bring-your-own", port: 80 }]);
      vi.stubEnv("FLISK_SERVICE_BASE_URL", undefined);
      vi.stubEnv("FLISK_PUBLIC_HOST", "https://public.test:8443");
      mockDockerDown();
      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toMatch(/api\.public\.test/);
    });

    it("gives a webUi bring-your-own service no IP loopback URL on Windows", async () => {
      setupProject("flisk-project", [
        { name: "dashboard", appType: "bring-your-own", port: 8080, webUi: true },
        { name: "vote", appType: "bring-your-own", port: 80 },
      ]);
      const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      mockDockerDown();
      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

      platform.mockRestore();
      const json = JSON.parse(lines.join("\n"));
      const services = (json.data?.services ?? json.services ?? json) as Array<{
        name: string;
        loopbackUrl?: string;
      }>;
      expect(services.find((s) => s.name === "dashboard")?.loopbackUrl).toBeUndefined();
      expect(services.find((s) => s.name === "vote")?.loopbackUrl).toContain("127.0.0.1");
    });

    it("renders two networks across stacks with running and stopped statuses and custom domain tip", async () => {
      setupProject("flisk-project", [
        { name: "web", appType: "frontend", stack: "shop", port: 5173, basePath: "/" },
        { name: "orders-api", appType: "backend", port: 4000 },
      ]);
      mockDockerDown();
      vi.mocked(globalThis.fetch).mockImplementation(
        async (input) =>
          new Response(null, { status: String(input).includes("app.localhost") ? 200 : 503 }),
      );

      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

      const output = stripVTControlCharacters(lines.join("\n"));
      expect(output).toContain("TRAEFIK NETWORKS");
      expect(output).toContain("SHOP STACK");
      expect(output).toContain("DEFAULT STACK");
      expect(output).toContain("http://app.localhost:80/");
      expect(output).toContain("http://api.localhost:80/api/orders");
      expect(output).toContain("[stopped]");
      expect(output).toContain("export FLISK_PUBLIC_HOST=flisk-project.localhost");
    });

    it("emits machine error envelope when --stack does not exist in --json mode", async () => {
      setupProject("acme", [{ name: "web", appType: "frontend", stack: "shop", port: 5173 }]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();

      await expect(
        networksCommand.parseAsync(["node", "flisk", "--stack", "missing", "--json"], {
          from: "node",
        }),
      ).rejects.toThrow();

      expect(exit).toHaveBeenCalledWith(1);
      const stdout = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      const envelope = parseEnvelope(stdout);
      expect(envelope.errors[0]?.code).toBe("STACK_NOT_FOUND");
    });

    it("emits machine error envelope when run outside a project in --json mode", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();

      await expect(
        networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" }),
      ).rejects.toThrow();

      expect(exit).toHaveBeenCalledWith(1);
      const stdout = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      const envelope = parseEnvelope(stdout);
      expect(envelope.errors[0]?.code).toBe("NOT_IN_PROJECT");
    });

    it("outputs JSON envelope, legacy JSON array, and raw URLs", async () => {
      setupProject("acme", [
        { name: "web", appType: "frontend", stack: "shop", port: 5173, basePath: "/shop" },
        { name: "orders-api", appType: "backend", stack: "shop", port: 4000 },
      ]);

      const lines = captureLogLines();

      await networksCommand.parseAsync(["node", "flisk", "--stack", "shop", "--json"], {
        from: "node",
      });
      // One compact line, so line-oriented readers (tail -1, JSON Lines) get the whole envelope.
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain("\n");
      const jsonReport = JSON.parse(lines[0]);
      expect(jsonReport.schemaVersion).toBe(1);
      expect(jsonReport.data.services).toHaveLength(2);
      expect(
        (jsonReport.data.services as Array<{ path: string }>).map((service) => service.path).sort(),
      ).toEqual(["services/shop/orders-api", "services/shop/web"]);

      lines.length = 0;
      networksCommand.setOptionValue("json", false);
      await networksCommand.parseAsync(["node", "flisk", "--stack", "shop", "--json-legacy"], {
        from: "node",
      });
      const legacyReport = JSON.parse(lines.join("\n"));
      expect(Array.isArray(legacyReport)).toBe(true);
      expect(legacyReport).toHaveLength(2);

      lines.length = 0;
      networksCommand.setOptionValue("jsonLegacy", false);
      const { exit } = captureExit();
      await expect(
        networksCommand.parseAsync(["node", "flisk", "--stack", "shop", "--raw"], {
          from: "node",
        }),
      ).rejects.toThrow();
      expect(exit).toHaveBeenCalledWith(0);
      expect(lines.join("\n")).toContain("http://app.acme.localhost:80/shop");
      expect(lines.join("\n")).toContain("http://api.acme.localhost:80/api/orders");
    });

    it("exits with error when --stack does not exist in interactive mode", async () => {
      setupProject("acme", [{ name: "web", appType: "frontend", stack: "shop", port: 5173 }]);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();

      await expect(
        networksCommand.parseAsync(["node", "flisk", "--stack", "missing"], { from: "node" }),
      ).rejects.toThrow();

      expect(exit).toHaveBeenCalledWith(1);
    });

    describe("native local-process project", () => {
      const commandServices = [
        { name: "app-api", appType: "backend", port: 4000, command: "bun run dev" },
        { name: "app-web", appType: "frontend", port: 3001, command: "bun run dev" },
      ];

      it("lists localhost URLs with the run state instead of Traefik URLs", async () => {
        setupProject("app", commandServices);
        writeNativeRun({
          "app-api": { pid: process.pid, port: 4000, ready: true },
          "app-web": { pid: process.pid, port: 3001, ready: true },
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        const output = stripVTControlCharacters(lines.join("\n"));
        expect(output).toContain("SERVICE ADDRESSES");
        expect(output).toContain("Local processes (no Docker, no Tilt)");
        expect(output).not.toContain("TRAEFIK NETWORKS");
        expect(output).toContain("http://localhost:4000");
        expect(output).toContain("http://localhost:3001");
        expect(output).not.toContain(":8080");
        expect(output).not.toContain("app.localhost");
        expect(output).not.toContain("api.localhost");
        expect(output).not.toContain("[stopped]");
        // No probes at all: no Docker lookups, no port plan and no HTTP checks.
        expect(childProcess.spawn).not.toHaveBeenCalled();
        expect(childProcess.execFileSync).not.toHaveBeenCalled();
        expect(hostPortPlan.createHostPortPlan).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("lists localhost URLs for a `flisk create` layout (api/ and web/ at the root), in text and --json", async () => {
        // `flisk create shop-demo` writes api/service.json and web/service.json at the project root,
        // not services/<stack>/<name> — the layout the issue report came from.
        setupProject("shop-demo", [
          {
            name: "shop-demo-api",
            appType: "backend",
            stack: "app",
            port: 4000,
            command: "npm run dev",
            dir: "api",
          },
          {
            name: "shop-demo-web",
            appType: "frontend",
            stack: "app",
            port: 3001,
            command: "npm run dev",
            dir: "web",
          },
        ]);
        writeNativeRun({
          "shop-demo-api": { pid: process.pid, port: 4000, ready: true },
          "shop-demo-web": { pid: process.pid, port: 3001, ready: true },
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        const output = stripVTControlCharacters(lines.join("\n"));
        expect(output).toContain("SERVICE ADDRESSES");
        expect(output).toContain("APP STACK");
        expect(output).toContain("http://localhost:4000");
        expect(output).toContain("http://localhost:3001");
        // The reported bug: dead <service>.<project>.localhost gateway URLs marked [stopped].
        expect(output).not.toContain("TRAEFIK NETWORKS");
        expect(output).not.toContain("shop-demo.localhost");
        expect(output).not.toContain("HTTP check failed");
        expect(output).not.toContain("[stopped]");
        expect(warnSpy).not.toHaveBeenCalled();

        lines.length = 0;
        await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

        const envelope = parseEnvelope(lines.join("\n"));
        expect(envelope.errors).toEqual([]);
        expect(envelope.data.warnings).toBeUndefined();
        const byName = Object.fromEntries(
          (envelope.data.services as Array<{ name: string; url: string; status: string }>).map(
            (service) => [service.name, service],
          ),
        );
        // The same run state `flisk status` reports (ready -> running).
        expect(byName["shop-demo-api"]).toMatchObject({
          url: "http://localhost:4000",
          status: "running",
        });
        expect(byName["shop-demo-web"]).toMatchObject({
          url: "http://localhost:3001",
          status: "running",
        });
      });

      it("reports the same states in --json: ready running, pending unknown, error and silent stopped", async () => {
        setupProject("app", [
          { name: "app-api", appType: "backend", port: 4000, command: "bun run dev" },
          { name: "app-web", appType: "frontend", port: 3001, command: "bun run dev" },
          { name: "cache", appType: "worker", port: 6379, command: "redis-server" },
          { name: "gone", appType: "backend", port: 4100, command: "bun run dev" },
        ]);
        writeNativeRun({
          "app-api": { pid: process.pid, port: 4000, ready: true },
          "app-web": { pid: process.pid, port: 3001, ready: false },
          cache: { pid: process.pid, port: 6379, ready: true, failed: true },
          // "gone" is not in the run on record, so its state is unknown.
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

        const envelope = parseEnvelope(lines.join("\n"));
        expect(envelope.errors).toEqual([]);
        expect(envelope.data.warnings).toBeUndefined();
        const byName = Object.fromEntries(
          (envelope.data.services as Array<{ name: string; url: string; status: string }>).map(
            (service) => [service.name, service],
          ),
        );
        expect(byName["app-api"]).toMatchObject({
          url: "http://localhost:4000",
          status: "running",
        });
        expect(byName["app-web"]).toMatchObject({
          url: "http://localhost:3001",
          status: "unknown",
        });
        expect(byName.cache).toMatchObject({
          url: "http://localhost:6379",
          status: "stopped",
        });
        expect(byName.gone).toMatchObject({
          url: "http://localhost:4100",
          status: "stopped",
        });
        expect(warnSpy).not.toHaveBeenCalled();
      });

      it("shows every service stopped when no native run is on record", async () => {
        setupProject("app", commandServices);
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

        const envelope = parseEnvelope(lines.join("\n"));
        expect((envelope.data.services as Array<{ status: string }>).map((s) => s.status)).toEqual([
          "stopped",
          "stopped",
        ]);
      });

      it("skips a local process with no port and prints only real addresses with --raw", async () => {
        setupProject("app", [
          ...commandServices,
          { name: "migrate", appType: "migrator", command: "bun run migrate" },
        ]);
        writeNativeRun({
          "app-api": { pid: process.pid, port: 4000, ready: true },
          "app-web": { pid: process.pid, port: 3001, ready: true },
          migrate: { ready: true },
        });
        const lines = captureLogLines();
        const { exit } = captureExit();

        await expect(
          networksCommand.parseAsync(["node", "flisk", "--raw"], { from: "node" }),
        ).rejects.toThrow();

        expect(exit).toHaveBeenCalledWith(0);
        expect(lines).toEqual(["http://localhost:4000", "http://localhost:3001"]);
      });

      it("keeps the Docker path when a command service sits next to a Dockerfile service", async () => {
        setupProject("app", [
          { name: "app-api", appType: "backend", port: 4000, command: "bun run dev" },
          { name: "app-web", appType: "frontend", port: 3001, dockerfile: "Dockerfile" },
        ]);
        vi.mocked(childProcess.spawn).mockImplementation(() =>
          createMockChildProcess({ error: new Error("spawn docker ENOENT") }),
        );
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        const output = stripVTControlCharacters(lines.join("\n"));
        // Not a native project (a Dockerfile next to command cannot run locally), so the Docker contract holds.
        expect(output).toContain("TRAEFIK NETWORKS");
        expect(output).toContain("[stopped]");
        expect(output).not.toContain("http://localhost:4000");
      });
    });

    describe("Docker-down warnings", () => {
      const fourServices = [
        { name: "traefik", appType: "backend", stack: "platform", port: 4001 },
        { name: "tilt", appType: "backend", stack: "platform", port: 4002 },
        { name: "web", appType: "frontend", stack: "shop", port: 5173 },
        { name: "orders-api", appType: "backend", stack: "shop", port: 4000 },
      ];

      function dockerDown(): void {
        vi.mocked(childProcess.spawn).mockImplementation(() =>
          createMockChildProcess({ error: new Error("spawn docker ENOENT") }),
        );
        vi.mocked(childProcess.execFileSync).mockImplementation(() => {
          throw new Error("Cannot connect to the Docker daemon");
        });
      }

      function dockerUp(): void {
        vi.mocked(childProcess.spawn).mockImplementation(() =>
          createMockChildProcess({ stdout: "" }),
        );
        vi.mocked(childProcess.execFileSync).mockImplementation(() => {
          throw new Error("Cannot connect to the Docker daemon");
        });
        vi.spyOn(portAssignment, "checkPortStatus").mockResolvedValue("stopped");
      }

      it("prints one warning, not one per service per check, when Docker is down", async () => {
        setupProject("acme", fourServices);
        dockerDown();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Docker is not running, so every service is shown as stopped"),
        );
        // Docker was probed once, not once per service.
        expect(childProcess.spawn).toHaveBeenCalledTimes(1);
      });

      it("puts the warning in the --json document and keeps stderr empty", async () => {
        setupProject("acme", fourServices);
        dockerDown();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const lines = captureLogLines();

        await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

        const envelope = parseEnvelope(lines.join("\n"));
        expect(envelope.errors).toEqual([]);
        expect(envelope.data.warnings).toEqual([
          "Docker is not running, so every service is shown as stopped",
        ]);
        for (const service of envelope.data.services as Array<{ status: string }>) {
          expect(service.status).toBe("stopped");
        }
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
      });

      it("prints the same single warning for the urls alias", async () => {
        setupProject("acme", fourServices);
        dockerDown();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        const program = new Command("flisk");
        program.addCommand(networksCommand);

        await program.parseAsync(["node", "flisk", "urls"], { from: "node" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Docker is not running, so every service is shown as stopped"),
        );
      });

      it("collapses the per-URL warnings when every service fails its HTTP check", async () => {
        setupProject("acme", fourServices);
        dockerUp();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(globalThis.fetch).mockRejectedValue(new Error("connect ECONNREFUSED"));

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("4 URLs not reachable"));
      });

      it("keeps one warning per failed URL when only some services fail the HTTP check", async () => {
        setupProject("acme", fourServices);
        dockerUp();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(globalThis.fetch)
          .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
          .mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

        await networksCommand.parseAsync(["node", "flisk"], { from: "node" });

        const httpWarnings = warnSpy.mock.calls.filter((call) =>
          String(call[0]).includes("HTTP check failed"),
        );
        expect(httpWarnings).toHaveLength(2);
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("URLs not reachable"));
      });

      it("adds no warnings key to --json output when every service answers", async () => {
        setupProject("acme", fourServices);
        dockerUp();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const lines = captureLogLines();
        vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 200 }));

        await networksCommand.parseAsync(["node", "flisk", "--json"], { from: "node" });

        const envelope = parseEnvelope(lines.join("\n"));
        expect(envelope.errors).toEqual([]);
        expect(envelope.data.warnings).toBeUndefined();
        expect(
          (envelope.data.services as Array<{ status: string }>).every(
            (service) => service.status === "running",
          ),
        ).toBe(true);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });
});
