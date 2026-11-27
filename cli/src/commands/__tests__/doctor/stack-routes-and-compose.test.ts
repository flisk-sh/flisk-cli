// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  cacheExecAsync,
  checkDockerCompose,
  checkDockerVersions,
  checkSharedStackRoutes,
  createAsyncCommandCache,
  describe,
  expect,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  rmSync,
  tmpdir,
  vi,
  writeFileSync,
} from "./test-support.js";

describe("checkSharedStackRoutes", () => {
  const originalCwd = process.cwd();
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "flisk-doctor-stack-routes-"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeResource(name: string, extra: Record<string, unknown> = {}) {
    const dir = join(testDir, "services", "shop", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "service.json"),
      JSON.stringify({ appName: name, appType: "backend", stack: "shop", ...extra }),
    );
  }

  function writeResourceIn(
    directory: string,
    name: string,
    stack: string,
    extra: Record<string, unknown> = {},
  ) {
    const dir = join(testDir, "services", directory, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "service.json"),
      JSON.stringify({ appName: name, appType: "backend", stack, ...extra }),
    );
  }

  it("passes when each stack has one backend", () => {
    writeResource("orders-api");
    expect(checkSharedStackRoutes(testDir).didPass).toBe(true);
  });

  it("warns, naming both backends, when two share a stack and neither sets a route", () => {
    writeResource("orders-api");
    writeResource("billing-api");

    const result = checkSharedStackRoutes(testDir);

    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain(
      "billing-api, orders-api lose the shared /api/shop-management route",
    );
    expect(result.fix).toContain("traefik.pathPrefix");
  });

  it("warns about only the backend that has no route of its own when the other sets a pathPrefix", () => {
    writeResource("orders-api");
    writeResource("billing-api", { traefik: { pathPrefix: "/api/billing" } });

    const result = checkSharedStackRoutes(testDir);

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("orders-api lose the shared");
    expect(result.message).not.toContain("billing-api lose");
  });

  it("warns when two services in different stacks resolve to one API path (orders and orders-api)", () => {
    writeResourceIn("orders", "orders", "orders");
    writeResourceIn("shop", "orders-api", "shop");

    const result = checkSharedStackRoutes(testDir);

    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("orders and orders-api are both routed at /api/orders");
    expect(result.fix).toContain('"apiPath"');
  });

  it("warns when two services set the same apiPath, with or without a trailing slash", () => {
    writeResourceIn("a", "alpha-api", "a", { apiPath: "/api/v1/things" });
    writeResourceIn("b", "beta-api", "b", { apiPath: "/api/v1/things/" });

    const result = checkSharedStackRoutes(testDir);

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("alpha-api and beta-api are both routed at /api/v1/things");
  });

  it("passes when services in different stacks resolve to different API paths", () => {
    writeResourceIn("orders", "orders-api", "orders");
    writeResourceIn("shop", "orders-admin", "shop");
    writeResourceIn("web", "orders-web", "web", { appType: "frontend" });
    expect(checkSharedStackRoutes(testDir).didPass).toBe(true);
  });

  it("passes when both backends set a different pathPrefix", () => {
    writeResource("orders-api", { traefik: { pathPrefix: "/api/orders-v1" } });
    writeResource("billing-api", { traefik: { pathPrefix: "/api/billing-v1" } });
    expect(checkSharedStackRoutes(testDir).didPass).toBe(true);
  });

  it("warns when two backends set the same pathPrefix", () => {
    writeResource("orders-api", { traefik: { pathPrefix: "/api/v1" } });
    writeResource("billing-api", { traefik: { pathPrefix: "/api/v1" } });

    const result = checkSharedStackRoutes(testDir);

    expect(result.didPass).toBe(false);
    expect(result.message).toContain(
      'billing-api and orders-api both set traefik.pathPrefix "/api/v1"',
    );
  });

  it("ignores workers, frontends and unproxied bring-your-own resources, like the engine", () => {
    writeResource("orders-api");
    writeResource("jobs", { appType: "worker" });
    writeResource("storefront", { appType: "frontend" });
    writeResource("legacy", { appType: "bring-your-own", exposeViaProxy: false });
    expect(checkSharedStackRoutes(testDir).didPass).toBe(true);
  });

  it("does not group two service directories that declare the same stack, because the engine counts per directory", () => {
    writeResource("orders-api");
    const dir = join(testDir, "services", "other", "billing-api");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "service.json"),
      JSON.stringify({ appName: "billing-api", appType: "backend", stack: "shop" }),
    );
    expect(checkSharedStackRoutes(testDir).didPass).toBe(true);
  });
});

describe("doctor Docker Compose check", () => {
  it("passes when the compose plugin answers", async () => {
    const result = await checkDockerCompose(async () => "Docker Compose version v2.38.2\n");

    expect(result.didPass).toBe(true);
  });

  it("gives the compose plugin a longer probe than other tools", async () => {
    const exec = vi.fn(async () => "v2.38.2\n");
    await checkDockerCompose(exec);
    expect(exec).toHaveBeenCalledWith("docker compose version --short", 30_000);
  });

  it("reports a timeout as not responding rather than missing", async () => {
    const timedOut = Object.assign(new Error("Command failed"), { killed: true });
    const result = await checkDockerCompose(async () => {
      throw timedOut;
    });

    expect(result.didPass).toBe(false);
    expect(result.message).toBe("Docker Compose did not respond within 30s");
    expect(result.message).not.toContain("not found");
    expect(result.fix).toContain("docs.docker.com/compose");
  });

  it("reports a failing command as not found", async () => {
    const result = await checkDockerCompose(async () => {
      throw Object.assign(new Error("docker: 'compose' is not a docker command"), { code: 1 });
    });

    expect(result.didPass).toBe(false);
    expect(result.message).toBe("Docker Compose plugin not found");
  });
});

describe("doctor shared compose version probe", () => {
  const composeCommand = "docker compose version --short";

  it("asks for the compose version with the same command and timeout in both checks", async () => {
    const seen: Array<[string, number]> = [];
    const recordingExec = (async (command: string, timeoutMs: number) => {
      if (command.startsWith("docker compose")) seen.push([command, timeoutMs]);
      return "2.39.1\n";
    }) as never;

    await checkDockerCompose(recordingExec);
    await checkDockerVersions(recordingExec);

    expect(seen).toEqual([
      [composeCommand, 30_000],
      [composeCommand, 30_000],
    ]);
  });

  it("runs docker compose version once when both checks share a per-run cache", async () => {
    const calls: string[] = [];
    const countingExec = (async (command: string) => {
      calls.push(command);
      return command.startsWith("docker compose") ? "2.39.1\n" : "29.8.0\n";
    }) as never;
    const cachedExec = cacheExecAsync(countingExec, createAsyncCommandCache());

    const [compose, versions] = await Promise.all([
      checkDockerCompose(cachedExec),
      checkDockerVersions(cachedExec),
    ]);

    expect(calls.filter((command) => command === composeCommand)).toHaveLength(1);
    expect(compose.didPass).toBe(true);
    expect(versions.didPass).toBe(true);
  });

  it("gives both checks the same cached error when docker compose version fails", async () => {
    let composeCalls = 0;
    const failingExec = (async (command: string) => {
      if (command.startsWith("docker compose")) {
        composeCalls += 1;
        throw new Error("compose is not a docker command");
      }
      return "29.8.0\n";
    }) as never;
    const cachedExec = cacheExecAsync(failingExec, createAsyncCommandCache());

    const compose = await checkDockerCompose(cachedExec);
    const versions = await checkDockerVersions(cachedExec);

    expect(composeCalls).toBe(1);
    expect(compose.message).toBe("Docker Compose plugin not found");
    expect(versions.isSkipped).toBe(true);
  });
});
