// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native run planning", () => {
  native.nativeTestContext({ pinPath: true });

  function startPlanned(
    root: string,
    resources: Parameters<typeof native.planNativeRun>[0],
    checkoutRoot = root,
  ) {
    const plan = native.planNativeRun(resources, {}, checkoutRoot);
    const supervisor = new native.NativeSupervisor(root, plan.services);
    native.supervisors.push(supervisor);
    return { plan, supervisor };
  }

  it("expands variable references, with and without a default, and reports unset ones", () => {
    const missing: string[] = [];
    expect(
      native.expandEnvValue(
        `http://localhost:${native.ref("API_PORT")}/${native.ref("NOPE")}${native.ref("MAYBE", "x")}`,
        { API_PORT: "4000" },
        (n) => missing.push(n),
      ),
    ).toBe("http://localhost:4000/x");
    expect(missing).toEqual(["NOPE"]);
  });

  it("orders services so each starts after what it depends on", () => {
    expect(
      native.dependencyWaves([
        { name: "web", dependsOn: ["api"] },
        { name: "api", dependsOn: ["db"] },
        { name: "db", dependsOn: [] },
        { name: "worker", dependsOn: ["db"] },
      ]),
    ).toEqual([["db"], ["api", "worker"], ["web"]]);
    expect(() =>
      native.dependencyWaves([
        { name: "a", dependsOn: ["b"] },
        { name: "b", dependsOn: ["a"] },
      ]),
    ).toThrow(/circular dependsOn between a, b/);
  });

  it("builds start plans with PORT, the health URL and the expanded env", () => {
    const plan = native.planNativeRun(
      [
        native.makeResource("api", "bring-your-own", {
          command: "node s.js",
          port: 4100,
          healthCheckPath: "/health",
          restart: "no",
        }),
        native.makeResource("web", "bring-your-own", {
          command: "node w.js",
          port: 3100,
          dependsOn: ["api"],
          env: {
            API_URL: `http://localhost:${native.ref("API_PORT", "4100")}`,
            TOKEN: native.ref("SECRET"),
          },
        }),
      ],
      { SECRET: "s3" },
    );
    expect(plan.errors).toEqual([]);
    expect(plan.missingVars).toEqual([]);
    expect(plan.services).toEqual([
      {
        name: "api",
        command: "node s.js",
        cwd: "/tmp/api",
        port: 4100,
        env: {
          PORT: "4100",
          FLISK_CHECKOUT_ID: expect.stringMatching(/^[0-9a-f]{8}$/),
          FLISK_CHECKOUT_NAME: expect.stringMatching(/^[a-z0-9-]+$/),
        },
        dependsOn: [],
        healthUrl: native.localUrl(4100, "/health"),
        rawHealthPath: "/health",
        url: native.localUrl(4100),
        restart: false,
      },
      expect.objectContaining({
        name: "web",
        env: {
          API_URL: native.localUrl(4100),
          TOKEN: "s3",
          PORT: "3100",
          FLISK_CHECKOUT_ID: expect.stringMatching(/^[0-9a-f]{8}$/),
          FLISK_CHECKOUT_NAME: expect.stringMatching(/^[a-z0-9-]+$/),
        },
        dependsOn: ["api"],
        healthUrl: undefined,
        restart: true,
      }),
    ]);
  });

  it("injects FLISK_CHECKOUT_ID and FLISK_CHECKOUT_NAME and expands them in env, healthCheck and probe", () => {
    const root = native.createTempDir("flisk-WT_Alpha-");
    const plan = native.planNativeRun(
      [
        native.nativeService(root, "api", {
          command: `node server.js --checkout ${native.ref("FLISK_CHECKOUT_ID")} --name ${native.ref("FLISK_CHECKOUT_NAME")}`,
          port: 4101,
          env: {
            COOKIE_NAME: `sid_${native.ref("FLISK_CHECKOUT_ID")}`,
            BUCKET: `${native.ref("FLISK_CHECKOUT_NAME")}-assets`,
          },
          healthCheck: {
            path: `/health/${native.ref("FLISK_CHECKOUT_ID")}`,
          },
        }),
        native.nativeService(root, "worker", {
          command: `node worker.js --id ${native.ref("FLISK_CHECKOUT_ID")}`,
          healthCheck: {
            command: [
              "probe",
              "--checkout",
              native.ref("FLISK_CHECKOUT_ID"),
              native.ref("FLISK_CHECKOUT_NAME"),
            ],
          },
        }),
      ],
      {},
      root,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.missingVars).toEqual([]);

    const api = plan.services.find((s) => s.name === "api");
    const worker = plan.services.find((s) => s.name === "worker");
    expect(api).toBeDefined();
    expect(worker).toBeDefined();

    const checkoutId = api?.env.FLISK_CHECKOUT_ID ?? "";
    const checkoutName = api?.env.FLISK_CHECKOUT_NAME ?? "";
    expect(checkoutId).toMatch(/^[0-9a-f]{8}$/);
    expect(checkoutName).toMatch(/^flisk-wt-alpha-/);

    expect(api?.env.COOKIE_NAME).toBe(`sid_${checkoutId}`);
    expect(api?.env.BUCKET).toBe(`${checkoutName}-assets`);
    // A local command line stays as written: the platform shell expands `${VAR}` at launch from the child
    // environment (FLISK_CHECKOUT_ID and FLISK_CHECKOUT_NAME reach it through env), so a value is never spliced
    // into the line and reparsed as shell syntax.
    expect(api?.command).toBe(
      `node server.js --checkout ${native.ref("FLISK_CHECKOUT_ID")} --name ${native.ref("FLISK_CHECKOUT_NAME")}`,
    );
    expect(api?.healthUrl).toBe(native.localUrl(4101, `/health/${checkoutId}`));
    expect(api?.rawHealthPath).toBe(`/health/${native.ref("FLISK_CHECKOUT_ID")}`);

    expect(worker?.env.FLISK_CHECKOUT_ID).toBe(checkoutId);
    expect(worker?.env.FLISK_CHECKOUT_NAME).toBe(checkoutName);
    expect(worker?.command).toBe(`node worker.js --id ${native.ref("FLISK_CHECKOUT_ID")}`);
    expect(worker?.readiness).toEqual({
      kind: "command",
      command: ["probe", "--checkout", checkoutId, checkoutName],
    });
    expect(worker?.rawProbe).toEqual({
      kind: "command",
      command: [
        "probe",
        "--checkout",
        native.ref("FLISK_CHECKOUT_ID"),
        native.ref("FLISK_CHECKOUT_NAME"),
      ],
    });
  });

  it("passes FLISK_CHECKOUT_ID and FLISK_CHECKOUT_NAME to mixed docker run containers and expands container.command", () => {
    const root = native.createTempDir("flisk-mixed-");
    const plan = native.planNativeRun(
      [
        native.makeResource("cache", "bring-your-own", {
          image: "redis:7-alpine",
          port: 6379,
          env: {
            KEY_PREFIX: `${native.ref("FLISK_CHECKOUT_NAME")}:${native.ref("FLISK_CHECKOUT_ID")}`,
          },
          container: {
            command: [
              "redis-server",
              "--save",
              "",
              "--syslog-ident",
              native.ref("FLISK_CHECKOUT_ID"),
            ],
          },
          healthCheck: { command: ["redis-cli", "ping", native.ref("FLISK_CHECKOUT_ID")] },
        }),
        native.nativeService(root, "api", { command: "node s.js", dependsOn: ["cache"] }),
      ],
      {},
      root,
      "shop",
    );

    expect(plan.errors).toEqual([]);
    const cache = plan.services.find((s) => s.name === "cache");
    const id = cache?.env.FLISK_CHECKOUT_ID ?? "";
    const name = cache?.env.FLISK_CHECKOUT_NAME ?? "";
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(name).toMatch(/^flisk-mixed-/);
    expect(cache?.env.KEY_PREFIX).toBe(`${name}:${id}`);
    expect(cache?.command).toContain("-e FLISK_CHECKOUT_ID -e FLISK_CHECKOUT_NAME");
    expect(cache?.command).toContain(`--syslog-ident ${id}`);
    expect(cache?.readiness).toEqual({
      kind: "command",
      command: ["docker", "exec", "flisk-shop-cache", "redis-cli", "ping", id],
    });
  });

  it("reports unresolved container command and entrypoint names in missingVars, but not defaulted ones", () => {
    const root = native.createTempDir("flisk-mixed-missing-");
    const plan = native.planNativeRun(
      [
        native.makeResource("cache", "bring-your-own", {
          image: "redis:7-alpine",
          port: 6379,
          container: {
            entrypoint: ["docker-entrypoint.sh", native.ref("GATEWAY_TOKEN")],
            command: [
              "redis-server",
              "--syslog-ident",
              native.ref("MISSING_IDENT"),
              "--appendonly",
              native.ref("CACHE_APPENDONLY", "no"),
            ],
          },
        }),
        native.nativeService(root, "api", {
          command: "node s.js",
          env: { REPLICA_OF: native.ref("CACHE_MODE", "replica") },
        }),
      ],
      {},
      root,
      "shop",
    );

    // The defaulted reference and the local command stay unreported; the container words report like env values.
    expect(plan.missingVars).toEqual(["cache: GATEWAY_TOKEN", "cache: MISSING_IDENT"]);
    // The defaulted container word resolves to its fallback instead of being left as a reference.
    const cache = plan.services.find((service) => service.name === "cache");
    expect(cache?.command).toContain("--appendonly no");
  });

  it("delivers FLISK_CHECKOUT_ID and FLISK_CHECKOUT_NAME into a spawned local process environment", async () => {
    const root = native.createTempDir("flisk-live-checkout-");
    native.writeFileSync(
      native.join(root, "dump-env.mjs"),
      `import { writeFileSync } from "node:fs";
writeFileSync("checkout.json", JSON.stringify({
  id: process.env.FLISK_CHECKOUT_ID,
  name: process.env.FLISK_CHECKOUT_NAME,
}));`,
    );
    const { plan, supervisor } = startPlanned(root, [
      native.nativeService(root, "job", {
        command: `${native.NODE} dump-env.mjs`,
        restart: "no",
      }),
    ]);
    const plannedId = plan.services[0]?.env.FLISK_CHECKOUT_ID;
    const plannedName = plan.services[0]?.env.FLISK_CHECKOUT_NAME;
    // Both must be planned: if both were missing and the parent had neither, the child would write nothing
    // and every comparison below would pass as undefined === undefined.
    expect(plannedId).toMatch(/^[0-9a-f]{8}$/);
    expect(plannedName).toBeTruthy();
    const failures = await supervisor.start();
    expect(failures).toEqual([]);
    await native.waitFor(() => native.existsSync(native.join(root, "checkout.json")));
    const written = JSON.parse(
      native.readFileSync(native.join(root, "checkout.json"), "utf-8"),
    ) as {
      id: string;
      name: string;
    };
    expect(written.id).toBe(plannedId);
    expect(written.name).toBe(plannedName);
  });

  // `${VAR}` in a command is expanded by the platform shell; cmd.exe leaves it as literal text.
  it.skipIf(process.platform === "win32")(
    "expands a FLISK_CHECKOUT_ID reference in a local command line through the POSIX shell",
    async () => {
      const root = native.createTempDir("flisk-live-checkout-arg-");
      native.writeFileSync(
        native.join(root, "dump-arg.mjs"),
        `import { writeFileSync } from "node:fs";
writeFileSync("checkout-arg.json", process.argv[2] ?? "");`,
      );
      const { plan, supervisor } = startPlanned(root, [
        native.nativeService(root, "job", {
          command: `${native.NODE} dump-arg.mjs ${native.ref("FLISK_CHECKOUT_ID")}`,
          restart: "no",
        }),
      ]);
      const plannedId = plan.services[0]?.env.FLISK_CHECKOUT_ID;
      expect(plannedId).toMatch(/^[0-9a-f]{8}$/);
      expect(await supervisor.start()).toEqual([]);
      await native.waitFor(() => native.existsSync(native.join(root, "checkout-arg.json")));
      expect(native.readFileSync(native.join(root, "checkout-arg.json"), "utf-8")).toBe(plannedId);
    },
  );

  it.skipIf(process.platform === "win32")(
    "delivers a shell-metacharacter value as one literal argument, never reparsed as shell syntax",
    async () => {
      const root = native.createTempDir("flisk-raw-cmd-");
      // A value with quotes, a substitution and backticks: splicing it into the shell line would rebalance quotes
      // and execute code. The platform shell expands the reference inside double quotes, so it stays one argument.
      const spicy = 'ab"c$(echo pwned)`id`';
      native.writeFileSync(
        native.join(root, "dump-arg.mjs"),
        `import { writeFileSync } from "node:fs";
writeFileSync("arg.json", process.argv[2] ?? "");`,
      );
      const { supervisor } = startPlanned(root, [
        native.nativeService(root, "job", {
          command: `${native.NODE} dump-arg.mjs "${native.ref("SPICY_TOKEN")}"`,
          env: { SPICY_TOKEN: spicy },
          restart: "no",
        }),
      ]);
      const failures = await supervisor.start();
      expect(failures).toEqual([]);
      await native.waitFor(() => native.existsSync(native.join(root, "arg.json")));
      expect(native.readFileSync(native.join(root, "arg.json"), "utf-8")).toBe(spicy);
    },
  );

  it("refuses a dependsOn on infrastructure the native runtime cannot start, and a shared port", () => {
    const plan = native.planNativeRun([
      native.makeResource("api", "bring-your-own", {
        command: "x",
        port: 4100,
        dependsOn: ["postgres"],
      }),
      native.makeResource("web", "bring-your-own", { command: "y", port: 4100 }),
    ]);
    expect(plan.errors).toEqual([
      expect.stringMatching(
        /^service "api" dependsOn "postgres", which is not a service in this project/,
      ),
      'services "api" and "web" both use port 4100',
    ]);
  });

  it("plans an image service as a docker run line, its probe inside the container, no PORT", () => {
    const plan = native.planNativeRun(
      [
        native.makeResource("postgres", "bring-your-own", {
          image: "postgres:15-alpine",
          port: 5432,
          env: { POSTGRES_PASSWORD: native.ref("PG_PASSWORD") },
          healthCheck: { command: ["pg_isready"] },
        }),
        native.makeResource("api", "bring-your-own", {
          command: "node s.js",
          dependsOn: ["postgres"],
        }),
      ],
      { PG_PASSWORD: "pw" },
      "/tmp",
      "shop",
    );
    expect(plan.errors).toEqual([]);
    const db = plan.services.find((service) => service.name === "postgres");
    expect(db).toMatchObject({
      container: "flisk-shop-postgres",
      env: { POSTGRES_PASSWORD: "pw" },
      readiness: {
        kind: "command",
        command: ["docker", "exec", "flisk-shop-postgres", "pg_isready"],
      },
      url: "localhost:5432",
    });
    expect(db?.command).toContain("-p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD");
    // The value reaches docker through its environment, never its arguments.
    expect(db?.command).not.toContain("pw");
    expect(plan.services.find((service) => service.name === "api")?.dependsOn).toEqual([
      "postgres",
    ]);
  });

  it("reads the deprecated dependencies key and expands a stack name, as the Docker path does", () => {
    const stacked = (name: string, stack: string, config: Record<string, unknown>) => ({
      ...native.makeResource(name, "bring-your-own", { command: "x", ...config }),
      stack,
    });
    const plan = native.planNativeRun([
      stacked("db", "core", {}),
      stacked("cache", "core", {}),
      stacked("api", "edge", { dependsOn: ["core"] }),
      stacked("web", "edge", { dependencies: ["db"] }),
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.services.find((s) => s.name === "api")?.dependsOn).toEqual(["db", "cache"]);
    expect(plan.services.find((s) => s.name === "web")?.dependsOn).toEqual(["db"]);
  });
});

native.describe("local enabled overrides in native planning", () => {
  native.it(
    "omits a disabled service from startup planning and names the disabled dependency",
    () => {
      const root = native.createTempDir();
      const api = native.nativeService(root, "api", {
        command: "node api.js",
        port: 4100,
        enabled: false,
      });
      const web = native.nativeService(root, "web", { command: "node web.js", dependsOn: ["api"] });

      const plan = native.planNativeRun([api, web]);
      expect(plan.services.map((service) => service.name)).toEqual(["web"]);
      expect(plan.errors[0]).toMatch(
        /service "web" dependsOn "api", which is disabled locally \(enabled: false in service\.json or its sibling service\.local\.json\)/,
      );
    },
  );

  native.it("still builds the environment of a disabled service for a one-off run", () => {
    const root = native.createTempDir();
    const api = native.nativeService(root, "api", {
      command: "node api.js",
      port: 4100,
      enabled: false,
      env: { TOKEN: "local" },
    });

    expect(native.planNativeRun([api]).services).toEqual([]);
    const oneOff = native.planNativeRun([api], {}, undefined, undefined, { includeDisabled: true });
    expect(oneOff.services[0]).toMatchObject({
      name: "api",
      env: expect.objectContaining({ TOKEN: "local", PORT: "4100" }),
    });
  });
});
