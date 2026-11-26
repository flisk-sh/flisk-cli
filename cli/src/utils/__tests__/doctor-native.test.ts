// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir, makeResource } from "../../test-support/index.js";
import {
  checkNativeCommands,
  checkNativeDependsOn,
  checkNativeEnvReferences,
  checkNativeRuntime,
  checkNativeServiceHealth,
  checkNativeServiceScripts,
} from "../doctor-native.js";

const service = (name: string, config: Record<string, unknown> = {}) =>
  makeResource(name, "bring-your-own", { command: "node server.js", ...config });

/** A `${NAME}` (or `${NAME:-fallback}`) reference, written out so it is not mistaken for a template literal. */
const ref = (name: string, fallback?: string) =>
  ["$", "{", name, fallback === undefined ? "" : `:-${fallback}`, "}"].join("");

describe("doctor checks for a project of local processes", () => {
  it("says Docker, Compose and Tilt are not needed", () => {
    expect(checkNativeRuntime([service("api"), service("web")])).toEqual({
      name: "Runtime",
      didPass: true,
      message:
        "Local processes: 2 services declare a command, so Docker, Compose and Tilt are not needed",
    });
  });

  it("fails when a command starts a program that is not installed", () => {
    const result = checkNativeCommands(
      [service("api"), service("ml", { command: "uv run main.py" })],
      (program) => (program === "node" ? "/usr/bin/node" : null),
    );
    expect(result).toMatchObject({ name: "Service commands", didPass: false });
    expect(result.message).toContain("ml: uv");
    expect(result.message).not.toContain("api");
  });

  it("passes when a package-manager script starts an installed program", () => {
    const result = checkNativeCommands(
      [makeResource("shop-api", "bring-your-own", { command: "npm run dev" })],
      (program) => (["npm", "node"].includes(program) ? "/usr/bin/tool" : null),
      () => JSON.stringify({ scripts: { dev: "node src/index.js" } }),
    );
    expect(result).toMatchObject({ name: "Service commands", didPass: true });
  });

  it("fails with the service, script and program when a script starts a missing program", () => {
    const result = checkNativeCommands(
      [makeResource("shop-api", "bring-your-own", { command: "npm run dev" })],
      (program) => (program === "npm" ? "/usr/bin/npm" : null),
      () => JSON.stringify({ scripts: { dev: "bun run --watch src/index.ts" } }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain('shop-api: script "dev" starts bun, which is not installed');
    expect(result.fix).toContain("https://bun.sh/docs/installation");
    expect(result.fix).toContain("package.json");
  });

  it("skips script resolution when the service has no package.json", () => {
    const result = checkNativeCommands(
      [makeResource("shop-api", "bring-your-own", { command: "npm run dev" })],
      (program) => (program === "npm" ? "/usr/bin/npm" : null),
      () => {
        throw new Error("ENOENT: package.json");
      },
    );
    expect(result).toEqual({
      name: "Service commands",
      didPass: true,
      message: "Every service command starts a program that is installed",
    });
  });

  it("checks the first program of each chained part of a script", () => {
    const result = checkNativeCommands(
      [makeResource("shop-api", "bring-your-own", { command: "npm run dev" })],
      (program) => (["npm", "bun"].includes(program) ? "/usr/bin/tool" : null),
      () => JSON.stringify({ scripts: { dev: "prisma generate && bun run src/index.ts" } }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain(
      'shop-api: script "dev" starts prisma, which is not installed',
    );
    expect(result.message).not.toContain("starts bun");
  });

  it("fails a dependsOn that is not a service of the project", () => {
    const result = checkNativeDependsOn([
      service("api", { dependsOn: ["postgres"] }),
      service("web", { dependsOn: ["api"] }),
    ]);
    expect(result).toMatchObject({ name: "Service dependencies", didPass: false });
    expect(result.message).toBe('api dependsOn "postgres", which is not a service of this project');
  });

  it("skips the health check when nothing runs", async () => {
    expect(await checkNativeServiceHealth(createTempDir(), [service("api")], 500)).toMatchObject({
      name: "Service Health",
      didPass: true,
      isSkipped: true,
    });
  });
});

describe("checkNativeEnvReferences", () => {
  const withDir = (name: string, config: Record<string, unknown>, root: string) => {
    const resource = service(name, config);
    resource.path = join(root, "services", name);
    resource.configPath = join(resource.path, "service.json");
    return resource;
  };

  it("warns with the service, the env key, the variable and where it looked", () => {
    const root = createTempDir();
    const api = withDir(
      "api",
      {
        env: {
          DB2_URL: `http://localhost:${ref("DB2_PORT")}`,
          A: ref("UNDEFINED_VAR"),
        },
      },
      root,
    );

    const result = checkNativeEnvReferences(root, [api], {});

    expect(result).toMatchObject({
      name: "Service env references",
      didPass: true,
      isWarning: true,
    });
    expect(result.message).toContain(
      `api: env DB2_URL references ${ref("DB2_PORT")}, which is not set (shell, .env, services/api/.env)`,
    );
    expect(result.message).toContain(`api: env A references ${ref("UNDEFINED_VAR")}`);
    expect(result.fix).toContain(":-default");
  });

  it("passes when the variable is in the run variables, an earlier env key, or has a default", () => {
    const root = createTempDir();
    const api = withDir(
      "api",
      {
        env: {
          FIRST: "one",
          FROM_VARS: ref("SET_VAR"),
          FROM_ENV: ref("FIRST"),
          GREETING: ref("GREET_SRC", "fallback"),
        },
      },
      root,
    );

    const result = checkNativeEnvReferences(root, [api], { SET_VAR: "x" });

    expect(result).toMatchObject({ didPass: true });
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("resolves to a value");
  });

  it("warns for a forward reference, which resolves to empty the same way at run time", () => {
    const root = createTempDir();
    const api = withDir("api", { env: { FROM_ENV: ref("LATER"), LATER: "one" } }, root);

    const result = checkNativeEnvReferences(root, [api], {});

    expect(result.isWarning).toBe(true);
    expect(result.message).toContain(`api: env FROM_ENV references ${ref("LATER")}`);
  });

  it("passes when the variable is in the service's own .env", () => {
    const root = createTempDir();
    const dir = join(root, "services", "api");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "SERVICE_PORT=4100\n");
    const api = service("api", { env: { URL: `http://localhost:${ref("SERVICE_PORT")}` } });
    api.path = dir;
    api.configPath = join(dir, "service.json");

    const result = checkNativeEnvReferences(root, [api], {});

    expect(result.isWarning).toBeUndefined();
  });

  it("reads the project .env like flisk up does", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "SHARED_KEY=from-project-env\n");
    const api = withDir("api", { env: { TOKEN: ref("SHARED_KEY") } }, root);

    const result = checkNativeEnvReferences(root, [api]);

    expect(result.isWarning).toBeUndefined();
  });

  it("reports each referencing key once per service", () => {
    const root = createTempDir();
    const api = withDir(
      "api",
      { env: { A: `${ref("MISSING")} ${ref("MISSING")}`, B: ref("MISSING") } },
      root,
    );

    const result = checkNativeEnvReferences(root, [api], {});

    expect(
      result.message.split("\n").filter((line) => line.includes("env A references")),
    ).toHaveLength(1);
    expect(result.message).toContain("api: env B references");
  });

  it("does not flag a migrator output reference that binds after the migrator runs", () => {
    const root = createTempDir();
    const migrate = withDir("migrate", { appType: "migrator" }, root);
    const api = withDir(
      "api",
      { dependsOn: ["migrate"], env: { TOKEN: ref("migrator:TOKEN") } },
      root,
    );

    const result = checkNativeEnvReferences(root, [migrate, api], {});

    expect(result.isWarning).toBeUndefined();
  });
});

describe("checkNativeServiceScripts", () => {
  const withPkg = (
    scripts: Record<string, string>,
    config: Record<string, unknown> = {},
    name = "worker",
    appType = "worker",
  ) => {
    const dir = createTempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
    const resource = makeResource(name, appType, { command: "node server.js", ...config });
    resource.path = dir;
    return resource;
  };

  it("fails when a command runs a missing package.json script", () => {
    const result = checkNativeServiceScripts([
      withPkg({ dev: "bun dev", build: "tsc" }, { command: "bun run worker" }, "my-worker"),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        name: "Service scripts",
        didPass: false,
      }),
    );
    expect(result.message).toContain("my-worker");
    expect(result.message).toContain('"bun run worker"');
    expect(result.message).toContain('no "worker" script');
    expect(result.message).toContain("scripts: dev, build");
    expect(result.fix).toContain("Add the missing script");
  });

  it("passes when the referenced script exists", () => {
    expect(
      checkNativeServiceScripts([
        withPkg({ worker: "bun src/worker.ts" }, { command: "bun run worker" }),
      ]),
    ).toEqual({
      name: "Service scripts",
      didPass: true,
      message: "Every service command script exists in package.json",
    });
  });

  it("passes for non-script commands", () => {
    expect(
      checkNativeServiceScripts([withPkg({ dev: "x" }, { command: "python app.py" })]).didPass,
    ).toBe(true);
  });

  it("skips when there is no package.json", () => {
    const dir = createTempDir();
    const resource = makeResource("api", "backend", { command: "bun run dev" });
    resource.path = dir;
    expect(checkNativeServiceScripts([resource]).didPass).toBe(true);
  });

  it("skips bring-your-own services", () => {
    const dir = createTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: {} }));
    const resource = makeResource("byo", "bring-your-own", { command: "bun run missing" });
    resource.path = dir;
    expect(checkNativeServiceScripts([resource]).didPass).toBe(true);
  });

  it("checks dev.command too", () => {
    const result = checkNativeServiceScripts([
      withPkg({ dev: "bun dev" }, { command: "node server.js", dev: { command: "npm run watch" } }),
    ]);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("npm run watch");
    expect(result.message).toContain('no "watch" script');
  });

  it("covers npm run, pnpm run, yarn run, yarn script, and bun script names", () => {
    const dir = createTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node ." } }));
    for (const command of [
      "npm run worker",
      "pnpm run worker",
      "yarn run worker",
      "yarn worker",
      "bun worker",
    ]) {
      const resource = makeResource("svc", "backend", { command });
      resource.path = dir;
      const result = checkNativeServiceScripts([resource]);
      expect(result.didPass, command).toBe(false);
      expect(result.message, command).toContain(`"${command}"`);
    }
  });

  it("does not flag bun/yarn file paths, builtins, or non-script commands", () => {
    const dir = createTempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    for (const command of [
      "bun src/index.ts",
      "bun test",
      "bun install",
      "bun run test",
      "yarn install",
      "python app.py",
    ]) {
      const resource = makeResource("svc", "backend", { command });
      resource.path = dir;
      expect(checkNativeServiceScripts([resource]).didPass, command).toBe(true);
    }
  });
});
