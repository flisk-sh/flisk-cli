// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { delimiter } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDir, makeResource } from "../../../test-support/index.js";
import {
  dependencyWaves,
  detachesServices,
  findMissingPrograms,
  isOneShotJob,
  localUrl,
  type NativeServicePlan,
  planNativeRun,
  resolvePlanLateValues,
} from "../plan.js";

/** A `${NAME}` (or `${NAME:-fallback}`) reference, written out so it is not mistaken for a template literal. */
const ref = (name: string, fallback?: string) =>
  ["$", "{", name, fallback === undefined ? "" : `:-${fallback}`, "}"].join("");

const basePlan = (over: Partial<NativeServicePlan> = {}): NativeServicePlan => ({
  name: "api",
  command: "node s.js",
  cwd: "/tmp/api",
  env: {},
  dependsOn: [],
  restart: true,
  ...over,
});

describe("plan cluster interface", () => {
  it("exports the plan surface", () => {
    for (const fn of [
      dependencyWaves,
      detachesServices,
      findMissingPrograms,
      isOneShotJob,
      localUrl,
      planNativeRun,
      resolvePlanLateValues,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("dependencyWaves", () => {
  it("orders services so each starts after what it depends on", () => {
    expect(
      dependencyWaves([
        { name: "web", dependsOn: ["api"] },
        { name: "api", dependsOn: ["db"] },
        { name: "db", dependsOn: [] },
        { name: "worker", dependsOn: ["db"] },
      ]),
    ).toEqual([["db"], ["api", "worker"], ["web"]]);
  });

  it("ignores dependencies that are not in the selection and throws on a cycle", () => {
    expect(dependencyWaves([{ name: "a", dependsOn: ["outside"] }])).toEqual([["a"]]);
    expect(() =>
      dependencyWaves([
        { name: "a", dependsOn: ["b"] },
        { name: "b", dependsOn: ["a"] },
      ]),
    ).toThrow(/circular dependsOn between a, b/);
  });
});

describe("isOneShotJob", () => {
  it("is true for a migrator and a bring-your-own with restart no", () => {
    expect(isOneShotJob(makeResource("m", "migrator", {}).config)).toBe(true);
    expect(isOneShotJob(makeResource("x", "bring-your-own", { restart: "no" }).config)).toBe(true);
    expect(isOneShotJob(makeResource("x", "bring-your-own", {}).config)).toBe(false);
    expect(isOneShotJob(undefined)).toBe(false);
  });
});

describe("localUrl", () => {
  it("builds the localhost URL with an optional path", () => {
    expect(localUrl(4100)).toBe("http://localhost:4100");
    expect(localUrl(4100, "/health")).toBe("http://localhost:4100/health");
  });
});

describe("detachesServices", () => {
  it("detaches everywhere but Windows", () => {
    expect(detachesServices("linux")).toBe(true);
    expect(detachesServices("darwin")).toBe(true);
    expect(detachesServices("win32")).toBe(false);
  });
});

describe("planNativeRun", () => {
  it("builds start plans with PORT, the health URL and the expanded env", () => {
    const plan = planNativeRun(
      [
        makeResource("api", "bring-your-own", {
          command: "node s.js",
          port: 4100,
          healthCheckPath: "/health",
          restart: "no",
        }),
        makeResource("web", "bring-your-own", {
          command: "node w.js",
          port: 3100,
          dependsOn: ["api"],
          env: { TOKEN: ref("SECRET") },
        }),
      ],
      { SECRET: "s3" },
    );
    expect(plan.errors).toEqual([]);
    expect(plan.missingVars).toEqual([]);
    const api = plan.services.find((s) => s.name === "api");
    const web = plan.services.find((s) => s.name === "web");
    expect(api?.env.PORT).toBe("4100");
    expect(api?.healthUrl).toBe(localUrl(4100, "/health"));
    expect(api?.restart).toBe(false);
    expect(web?.env.TOKEN).toBe("s3");
    expect(web?.dependsOn).toEqual(["api"]);
  });

  it("reports a dependsOn that is not a selected service, a shared port and a missing var", () => {
    const plan = planNativeRun(
      [
        makeResource("a", "bring-your-own", {
          command: "node a.js",
          port: 4001,
          dependsOn: ["postgres"],
          env: { NEEDS: ref("UNSET_VAR") },
        }),
        makeResource("b", "bring-your-own", { command: "node b.js", port: 4001 }),
      ],
      {},
    );
    expect(plan.errors).toEqual([
      expect.stringContaining(`dependsOn "postgres"`),
      'services "a" and "b" both use port 4001',
    ]);
    expect(plan.missingVars).toEqual(["a: UNSET_VAR"]);
    expect(plan.missingEnvRefs).toEqual([{ service: "a", key: "NEEDS", name: "UNSET_VAR" }]);
  });

  it("marks a migrator as a one-shot job with an output file", () => {
    const root = createTempDir();
    const plan = planNativeRun(
      [makeResource("migrate", "migrator", { command: "node migrate.js" })],
      {},
      root,
    );
    const migrate = plan.services[0];
    expect(migrate?.job).toBe(true);
    expect(migrate?.restart).toBe(false);
    expect(migrate?.env.FLISK_OUTPUT).toContain("migrate");
  });

  it("passes params to a command service literally, below env and the generated values", () => {
    const plan = planNativeRun(
      [
        makeResource("api", "backend", {
          command: "node s.js",
          port: 4100,
          params: {
            GREETING: "hi",
            LITERAL: ref("UNSET_VAR"),
            PORT: "9999",
            SHARED: "from params",
          },
          env: { SHARED: "from env" },
          envVars: { IGNORED: "x" },
        }),
      ],
      {},
    );
    const api = plan.services[0];
    expect(plan.errors).toEqual([]);
    expect(api?.env.GREETING).toBe("hi");
    // Params are literal config, so a ${VAR} in one reaches the process as written, like the container env file.
    expect(api?.env.LITERAL).toBe(ref("UNSET_VAR"));
    expect(plan.missingVars).toEqual([]);
    // `env` wins on a shared name, and a param cannot shadow the generated PORT.
    expect(api?.env.SHARED).toBe("from env");
    expect(api?.env.PORT).toBe("4100");
    expect(api?.env.IGNORED).toBeUndefined();
  });

  it("reads the deprecated envVars only when params is absent", () => {
    const withParams = planNativeRun(
      [
        makeResource("a", "backend", {
          command: "node a.js",
          params: {},
          envVars: { OLD: "1" },
        }),
      ],
      {},
    ).services[0];
    expect(withParams?.env.OLD).toBeUndefined();
    const withoutParams = planNativeRun(
      [makeResource("b", "backend", { command: "node b.js", envVars: { OLD: "1" } })],
      {},
    ).services[0];
    expect(withoutParams?.env.OLD).toBe("1");
  });

  it("reads nothing from a params block that is not an object", () => {
    const plan = planNativeRun(
      [makeResource("a", "backend", { command: "node a.js", params: "nope" })],
      {},
    );
    expect(Object.keys(plan.services[0]?.env ?? {}).sort()).toEqual([
      "FLISK_CHECKOUT_ID",
      "FLISK_CHECKOUT_NAME",
    ]);
  });
});

describe("findMissingPrograms", () => {
  const ambientPath = process.env.PATH;

  beforeEach(() => {
    process.env.PATH = ["/usr/local/bin", "/usr/bin", "/bin"].join(delimiter);
  });

  afterEach(() => {
    process.env.PATH = ambientPath;
  });

  it("names the program of a service whose command is not on PATH", () => {
    const missing = findMissingPrograms(
      [basePlan({ name: "api", command: "definitely-not-a-real-program-xyz serve" })],
      () => null,
    );
    expect(missing).toEqual([{ name: "api", program: "definitely-not-a-real-program-xyz" }]);
  });

  it("sees the program after a leading cd and leaves unresolvable commands alone", () => {
    const missing = findMissingPrograms(
      [
        basePlan({ name: "setup", command: "cd ../app && missing-tool-xyz install" }),
        basePlan({ name: "piped", command: "echo hi | grep h" }),
        basePlan({ name: "ok", command: "echo hi" }),
      ],
      () => null,
    );
    expect(missing).toEqual([{ name: "setup", program: "missing-tool-xyz" }]);
  });

  it("checks a relative command path in the service directory", () => {
    const missing = findMissingPrograms(
      [basePlan({ name: "api", command: "./bin/serve" })],
      () => null,
      () => false,
    );
    expect(missing).toEqual([{ name: "api", program: "./bin/serve" }]);
    expect(
      findMissingPrograms(
        [basePlan({ name: "api", command: "./bin/serve" })],
        () => null,
        () => true,
      ),
    ).toEqual([]);
  });

  it("reports the script a missing program came from (#4680)", () => {
    expect(
      findMissingPrograms(
        [basePlan({ name: "shop-api", command: "npm run dev" })],
        (program) => (program === "npm" ? "/usr/bin/npm" : null),
        undefined,
        () => JSON.stringify({ scripts: { dev: "bun run --watch src/index.ts" } }),
      ),
    ).toEqual([{ name: "shop-api", program: "bun", script: "dev" }]);
  });
});

describe("resolvePlanLateValues", () => {
  it("binds migrator outputs into env, the health path and the probe words", () => {
    const plan = basePlan({
      port: 4400,
      env: { TOKEN: "placeholder" },
      rawEnv: { TOKEN: ref("migrate:token") },
      dependsOn: ["migrate"],
      rawHealthPath: `/health/${ref("TOKEN")}`,
      healthUrl: localUrl(4400, `/health/${ref("TOKEN")}`),
      rawProbe: { kind: "command", command: ["check", ref("migrate:token")] },
    });
    resolvePlanLateValues(plan, { migrate: { token: "t-123" } }, {});
    expect(plan.env.TOKEN).toBe("t-123");
    expect(plan.healthUrl).toBe(localUrl(4400, "/health/t-123"));
    expect(plan.readiness).toEqual({ kind: "command", command: ["check", "t-123"] });
  });

  it("does nothing for a plan without late values", () => {
    const plan = basePlan();
    resolvePlanLateValues(plan, {}, {});
    expect(plan.healthUrl).toBeUndefined();
    expect(plan.readiness).toBeUndefined();
  });

  it("wraps the probe in docker exec for a container service", () => {
    const plan = basePlan({
      container: "myproj-db-1",
      rawProbe: { kind: "command", command: ["pg_isready"] },
    });
    resolvePlanLateValues(plan, {}, {});
    expect(plan.readiness).toEqual({
      kind: "command",
      command: ["docker", "exec", "myproj-db-1", "pg_isready"],
    });
  });
});
