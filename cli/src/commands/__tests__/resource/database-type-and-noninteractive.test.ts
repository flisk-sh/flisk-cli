// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  createDatabaseServiceJson,
  createResourceProject,
  createServiceJson,
  describe,
  existsSync,
  expect,
  FliskError,
  it,
  join,
  mkdirSync,
  parseExistingServiceJson,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  runResourceCli,
  writeFileSync,
} from "./test-support.js";

describe("resource command database type (#2863)", () => {
  it("writes only a service.json that declares the project's Postgres", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "shop-db",
        "--type",
        "database",
        "--stack",
        "shop",
        "--json",
      ]);
      const serviceDir = join(projectRoot, "services", "shop", "shop-db");
      const envelope = JSON.parse(result.stdout.trim());

      expect(result.status).toBe(0);
      expect(envelope.data).toMatchObject({
        action: "created",
        name: "shop-db",
        type: "database",
        stack: "shop",
        port: null,
        path: "services/shop/shop-db",
        framework: "postgres",
      });
      expect(JSON.parse(readFileSync(join(serviceDir, "service.json"), "utf8"))).toEqual(
        createDatabaseServiceJson("shop-db", "shop"),
      );
      expect(createDatabaseServiceJson("shop-db", "shop")).toMatchObject({
        appType: "database",
        framework: "postgres",
        schemaVersion: 1,
      });
      // No code, Dockerfile or port: Flisk runs the database itself.
      expect(readdirSync(serviceDir)).toEqual(["service.json"]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [["--framework", "oracle"], "--framework oracle is not a database Flisk can run"],
    [["--port", "5432"], "--port cannot be used with --type database"],
    [["--image", "postgres:17"], "--image cannot be used with --type database"],
    [["--feature", "prisma"], "--feature cannot be used with --type database"],
  ])("rejects %j before writing anything", (flags, message) => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "shop-db",
        "--type",
        "database",
        "--yes",
        ...flags,
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(message);
      expect(existsSync(join(projectRoot, "services", "main", "shop-db"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("says the new database points at the shared PostgreSQL (#5335)", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "shop-db",
        "--type",
        "database",
        "--stack",
        "shop",
        "--yes",
      ]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(0);
      expect(output).toContain(`"shop-db" points at the project's shared PostgreSQL`);
      expect(output).toContain("it starts no database of its own");
      expect(output).toContain("they get DATABASE_URL");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("accepts --framework postgres", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "shop-db",
        "--type",
        "database",
        "--framework",
        "postgres",
        "--yes",
      ]);

      expect(result.status).toBe(0);
      const serviceJson = JSON.parse(
        readFileSync(join(projectRoot, "services", "main", "shop-db", "service.json"), "utf8"),
      );
      expect(serviceJson.framework).toBe("postgres");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("resource command non-interactive mode", () => {
  it("does not create a resource when a prompt receives no input", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["api", "--type", "backend"]);

      expect(result.status).toBe(1);
      expect(existsSync(join(projectRoot, "services", "main", "api", "service.json"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails clearly when an SDK has no service.json to register", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, [
        "r-sdk",
        "--type",
        "sdk",
        "--stack",
        "shop",
        "--yes",
      ]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      expect(output).toContain("No service.json in packages/r-sdk");
      expect(output).toContain('Add one with "appType": "sdk", then run this again to register it');
      expect(existsSync(join(projectRoot, "packages", "r-sdk"))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("requires --yes without --stack even when confirmation input is piped through stdin (#5349)", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["api", "--type", "backend"], "y\n");
      const servicesDir = join(projectRoot, "services");

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--yes or a terminal");
      expect(existsSync(servicesDir)).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("requires a resource name with --yes instead of prompting", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["--type", "backend", "--yes"]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      expect(output).toContain("resource name is required");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses the default frontend framework with --yes instead of prompting", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["web", "--type", "frontend", "--yes"]);
      const manifestPath = join(projectRoot, "services", "main", "web", "service.json");

      expect(result.status).toBe(0);
      expect(existsSync(manifestPath)).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, "utf-8")).framework).toBe("react");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not read a manifest in another stack's folder before the stack is chosen (no --stack)", () => {
    const projectRoot = createResourceProject();
    try {
      // services/default/api is not where --yes puts the resource (it uses the only stack, main), so its broken manifest must not abort the run.
      mkdirSync(join(projectRoot, "services", "default", "api"), { recursive: true });
      writeFileSync(join(projectRoot, "services", "default", "api", "service.json"), "{ not json");
      const result = runResourceCli(projectRoot, ["api", "--type", "backend", "--yes"]);

      expect(result.status).toBe(0);
      expect(existsSync(join(projectRoot, "services", "main", "api", "service.json"))).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses the default main stack and creates a named resource with --yes", () => {
    const projectRoot = createResourceProject();
    try {
      const result = runResourceCli(projectRoot, ["api", "--type", "backend", "--yes"]);
      const manifestPath = join(projectRoot, "services", "main", "api", "service.json");

      expect(result.status).toBe(0);
      expect(existsSync(manifestPath)).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).stack).toBe("main");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("reuses the only existing stack with --yes", () => {
    const projectRoot = createResourceProject();
    try {
      const existingDir = join(projectRoot, "services", "team", "existing");
      mkdirSync(existingDir, { recursive: true });
      writeFileSync(
        join(existingDir, "service.json"),
        JSON.stringify(createServiceJson("existing-team", "backend", "team", 4100)),
      );

      const result = runResourceCli(projectRoot, ["new-api", "--type", "backend", "--yes"]);
      const manifestPath = join(projectRoot, "services", "team", "new-api", "service.json");

      expect(result.status).toBe(0);
      expect(existsSync(manifestPath)).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).stack).toBe("team");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("requires --stack rather than guessing when --yes finds multiple stacks", () => {
    const projectRoot = createResourceProject();
    try {
      for (const [index, stack] of ["alpha", "beta"].entries()) {
        const resourceDir = join(projectRoot, "services", stack, "existing");
        mkdirSync(resourceDir, { recursive: true });
        writeFileSync(
          join(resourceDir, "service.json"),
          JSON.stringify(createServiceJson(`existing-${stack}`, "backend", stack, 4100 + index)),
        );
      }

      const result = runResourceCli(projectRoot, ["new-api", "--type", "backend", "--yes"]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      expect(output).toContain("--stack");
      expect(existsSync(join(projectRoot, "services", "alpha", "new-api", "service.json"))).toBe(
        false,
      );
      expect(existsSync(join(projectRoot, "services", "beta", "new-api", "service.json"))).toBe(
        false,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("wraps a malformed service.json in a FliskError naming the file during registration", () => {
    expect(() =>
      parseExistingServiceJson('{"appName": "broken",', "/tmp/services/main/broken/service.json"),
    ).toThrow(FliskError);
    expect(() =>
      parseExistingServiceJson('{"appName": "broken",', "/tmp/services/main/broken/service.json"),
    ).toThrow(/Could not parse service\.json at \/tmp\/services\/main\/broken\/service\.json:/);

    const projectRoot = createResourceProject();
    try {
      const resourceDir = join(projectRoot, "services", "main", "broken");
      const manifestPath = join(resourceDir, "service.json");
      mkdirSync(resourceDir, { recursive: true });
      writeFileSync(manifestPath, '{"appName": "broken",\n');

      const result = runResourceCli(projectRoot, [
        "broken",
        "--type",
        "backend",
        "--path",
        "services/main/broken",
        "--register-existing",
        "--yes",
      ]);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      // The CLI reports the manifest path it actually read, which is the resolved
      // (symlink-free) path: on macOS the temporary directory is `/var/...` but the
      // spawned process sees `/private/var/...`.
      expect(output).toContain(`Could not parse service.json at ${realpathSync(manifestPath)}:`);
      expect(readFileSync(manifestPath, "utf8")).toBe('{"appName": "broken",\n');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
